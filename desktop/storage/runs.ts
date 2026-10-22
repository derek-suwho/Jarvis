import { randomUUID } from 'node:crypto';
import type { ProviderId, RunState, TurnInput } from '../../src/shared/contracts';
import type { RunRecord } from '../../src/shared/domain';
import type { Database } from './database';

type RunRow = {
  id: string; chat_id: string; request_id: string; user_message_id: string; assistant_message_id: string;
  provider_id: ProviderId; model_id: string; state: RunState; error: string | null;
  input_json: string; request_key: string; retry_of: string | null;
};
const record = (r: RunRow): RunRecord => ({ id: r.id, chatId: r.chat_id, requestId: r.request_id, userMessageId: r.user_message_id, assistantMessageId: r.assistant_message_id, model: { providerId: r.provider_id, modelId: r.model_id }, state: r.state, error: r.error });
const active = (state: RunState) => state === 'queued' || state === 'streaming';
const terminal = new Set<RunState>(['complete', 'cancelled', 'failed', 'interrupted']);
const providers = new Set<ProviderId>(['chatgpt', 'claude', 'grok', 'gemini']);

function canonical(input: TurnInput): TurnInput {
  if (!input || typeof input.requestId !== 'string' || !input.requestId.trim() || typeof input.chatId !== 'string' || !input.chatId.trim() || typeof input.text !== 'string' || !input.text.trim() || !input.model || !providers.has(input.model.providerId) || typeof input.model.modelId !== 'string' || !input.model.modelId.trim() || (input.reasoning !== undefined && typeof input.reasoning !== 'string')) throw new Error('Invalid turn input');
  return { requestId: input.requestId, chatId: input.chatId, text: input.text, model: { providerId: input.model.providerId, modelId: input.model.modelId }, ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }) };
}

export function createRunStore(db: Database) {
  const row = (id: string) => db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  function existing(requestId: string, key: string): RunRecord | null {
    const found = db.prepare('SELECT * FROM runs WHERE request_id = ?').get(requestId) as RunRow | undefined;
    if (!found) return null;
    if (found.request_key !== key) throw new Error('Conflicting requestId reuse');
    return record(found);
  }
  function ensureAvailable(chatId: string): void {
    if (!db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId)) throw new Error('Chat not found');
    if (db.prepare("SELECT 1 FROM runs WHERE chat_id = ? AND state IN ('queued', 'streaming')").get(chatId)) throw new Error('Chat already has an active run');
  }
  function insert(input: TurnInput, key: string, userMessageId: string, retryOf: string | null): RunRecord {
    const id = randomUUID(), assistantMessageId = randomUUID(), now = new Date().toISOString();
    db.prepare("INSERT INTO messages(id, chat_id, role, content, created_at, run_id) VALUES (?, ?, 'assistant', '', ?, ?)").run(assistantMessageId, input.chatId, now, id);
    db.prepare(`INSERT INTO runs(id, chat_id, request_id, user_message_id, assistant_message_id, provider_id, model_id, state, input_json, request_key, retry_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(id, input.chatId, input.requestId, userMessageId, assistantMessageId, input.model.providerId, input.model.modelId, JSON.stringify(input), key, retryOf);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, input.chatId);
    return record(row(id)!);
  }
  return {
    get(id: string): RunRecord | null { const found = row(id); return found ? record(found) : null; },
    getInput(id: string): TurnInput | null { const found = row(id); return found ? JSON.parse(found.input_json) as TurnInput : null; },
    list(chatId: string): RunRecord[] { return (db.prepare('SELECT * FROM runs WHERE chat_id = ? ORDER BY rowid').all(chatId) as RunRow[]).map(record); },
    listActive(chatId?: string): RunRecord[] {
      return (db.prepare("SELECT * FROM runs WHERE state IN ('queued', 'streaming')" + (chatId === undefined ? '' : ' AND chat_id = ?') + ' ORDER BY rowid').all(...(chatId === undefined ? [] : [chatId])) as RunRow[]).map(record);
    },
    begin(raw: TurnInput): RunRecord {
      const input = canonical(raw), key = JSON.stringify({ kind: 'send', input });
      return db.transaction(() => {
        const found = existing(input.requestId, key); if (found) return found;
        ensureAvailable(input.chatId);
        const userMessageId = randomUUID(), now = new Date().toISOString();
        const first = !db.prepare("SELECT 1 FROM messages WHERE chat_id = ? AND role = 'user'").get(input.chatId);
        db.prepare("INSERT INTO messages(id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)").run(userMessageId, input.chatId, input.text, now);
        const run = insert(input, key, userMessageId, null);
        db.prepare('UPDATE messages SET run_id = ? WHERE id = ?').run(run.id, userMessageId);
        if (first) {
          const text = input.text.trim().replace(/\s+/g, ' '), title = text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
          db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, input.chatId);
        }
        return run;
      }).immediate();
    },
    appendDelta(runId: string, text: string): void {
      if (typeof text !== 'string') throw new Error('Invalid delta');
      db.transaction(() => {
        const run = row(runId); if (!run || !active(run.state) || !text) return;
        db.prepare('UPDATE messages SET content = content || ? WHERE id = ?').run(text, run.assistant_message_id);
        db.prepare("UPDATE runs SET state = 'streaming' WHERE id = ?").run(runId);
        db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), run.chat_id);
      }).immediate();
    },
    finish(runId: string, state: RunState, error?: string): void {
      if (!terminal.has(state)) throw new Error('Expected terminal run state');
      db.transaction(() => {
        const run = row(runId); if (!run || !active(run.state)) return;
        db.prepare('UPDATE runs SET state = ?, error = ? WHERE id = ?').run(state, error ?? null, runId);
        db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), run.chat_id);
      }).immediate();
    },
    retry(runId: string, requestId: string): RunRecord {
      if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Invalid requestId');
      const key = JSON.stringify({ kind: 'retry', runId, requestId });
      return db.transaction(() => {
        const found = existing(requestId, key); if (found) return found;
        const original = row(runId); if (!original) throw new Error('Run not found');
        if (active(original.state)) throw new Error('Cannot retry active run');
        if (original.state === 'complete') throw new Error('Cannot retry complete run');
        ensureAvailable(original.chat_id);
        const input = canonical({ ...JSON.parse(original.input_json) as TurnInput, requestId });
        return insert(input, key, original.user_message_id, runId);
      }).immediate();
    },
    recoverInterrupted(): number {
      return db.transaction(() => db.prepare("UPDATE runs SET state = 'interrupted', error = 'Application stopped before completion' WHERE state IN ('queued', 'streaming')").run().changes).immediate();
    },
  };
}
export type RunStore = ReturnType<typeof createRunStore>;
