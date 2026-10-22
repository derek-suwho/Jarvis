import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { createChatStore } from '../../desktop/storage/chats';
import { createProjectStore } from '../../desktop/storage/projects';
import { createRunStore } from '../../desktop/storage/runs';
import type { TurnInput } from '../../src/shared/contracts';

describe('durable run lifecycle', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => { db = openDatabase(':memory:'); });
  afterEach(() => db.close());
  const model = { providerId: 'chatgpt' as const, modelId: 'model-1' };
  function setup() { const chats = createChatStore(db), runs = createRunStore(db); const chat = chats.create(null); const input: TurnInput = { requestId: 'request-1', chatId: chat.id, text: 'Remember me', model }; return { chats, runs, chat, input }; }

  it('returns same run for duplicate sends, rejecting conflicting request reuse', () => {
    const { chats, runs, chat, input } = setup(), first = runs.begin(input);
    expect(runs.begin(input)).toEqual(first);
    for (const changed of [{ text: 'different' }, { model: { ...model, modelId: 'other' } }, { reasoning: 'high' }, { chatId: chats.create(null).id }]) {
      expect(() => runs.begin({ ...input, ...changed })).toThrow(/request/i);
    }
    expect(chats.get(chat.id)?.messages.filter(m => m.role === 'user')).toHaveLength(1);
  });

  it('permits one active run per chat and concurrent runs across chats', () => {
    const { chats, runs, input } = setup(); runs.begin(input);
    expect(() => runs.begin({ ...input, requestId: 'request-2' })).toThrow(/active/i);
    const other = chats.create(null), second = runs.begin({ ...input, requestId: 'other', chatId: other.id });
    expect(runs.listActive()).toHaveLength(2);
    expect(runs.listActive(other.id).map(r => r.id)).toEqual([second.id]);
  });

  it('uses globally increasing user evidence sequences after deletion', () => {
    const { chats, runs, chat, input } = setup(); runs.begin(input);
    const sequence = chats.get(chat.id)!.messages[0].sourceSequence!;
    chats.delete(chat.id);
    const next = chats.create(null); runs.begin({ ...input, chatId: next.id, requestId: 'next' });
    const messages = chats.get(next.id)!.messages;
    expect(messages[0].sourceSequence).toBeGreaterThan(sequence);
    expect(messages[1].sourceSequence).toBeNull();
  });

  it('retries against original user without duplicating it, preserving failed partial output', () => {
    const { chats, runs, chat, input } = setup(), first = runs.begin(input);
    expect(() => runs.retry(first.id, 'retry')).toThrow(/active/i);
    runs.appendDelta(first.id, 'partial'); runs.finish(first.id, 'failed', 'offline');
    const retry = runs.retry(first.id, 'retry');
    expect(retry).toMatchObject({ userMessageId: first.userMessageId, state: 'queued', model });
    expect(retry.assistantMessageId).not.toBe(first.assistantMessageId);
    expect(runs.retry(first.id, 'retry')).toEqual(retry);
    expect(() => runs.begin({ ...input, requestId: 'retry' })).toThrow(/request/i);
    expect(runs.getInput(retry.id)).toEqual({ ...input, requestId: 'retry' });
    runs.appendDelta(retry.id, 'complete answer'); runs.finish(retry.id, 'complete');
    const snapshot = chats.get(chat.id)!;
    expect(snapshot.messages.map(m => m.content)).toEqual(['Remember me', 'partial', 'complete answer']);
    expect(snapshot.runs.map(r => r.state)).toEqual(['failed', 'complete']);
    expect(() => runs.retry(retry.id, 'third')).toThrow(/complete/i);
  });

  it.each(['complete', 'failed', 'cancelled', 'interrupted'] as const)('keeps %s runs immutable under late events', state => {
    const { chats, runs, chat, input } = setup(), run = runs.begin(input);
    runs.appendDelta(run.id, 'before'); runs.finish(run.id, state, 'original');
    runs.appendDelta(run.id, 'late'); runs.finish(run.id, 'complete', 'late');
    expect(runs.get(run.id)).toMatchObject({ state, error: 'original' });
    expect(chats.get(chat.id)?.messages[1].content).toBe('before');
  });

  it('recovers only unfinished attempts without resubmission', () => {
    const { chats, runs, input } = setup(), finished = runs.begin(input); runs.finish(finished.id, 'complete');
    const queued = runs.begin({ ...input, requestId: 'queued' });
    const other = chats.create(null), streaming = runs.begin({ ...input, chatId: other.id, requestId: 'streaming' }); runs.appendDelta(streaming.id, 'saved partial');
    expect(runs.recoverInterrupted()).toBe(2); expect(runs.recoverInterrupted()).toBe(0);
    expect(runs.get(queued.id)?.state).toBe('interrupted'); expect(runs.get(streaming.id)?.state).toBe('interrupted');
    expect(runs.get(finished.id)?.state).toBe('complete');
    expect(chats.get(other.id)?.messages[1].content).toBe('saved partial');
    expect(() => runs.finish(finished.id, 'queued')).toThrow(/terminal/i);
  });

  it('deletes projects and chats atomically; late deltas cannot resurrect data', () => {
    const { chats, runs, chat, input } = setup(), run = runs.begin(input);
    const projects = createProjectStore(db), project = projects.create('Delete', []), child = chats.create(project.id);
    const childRun = runs.begin({ ...input, requestId: 'child', chatId: child.id });
    chats.delete(chat.id); projects.delete(project.id);
    for (const id of [run.id, childRun.id]) { runs.appendDelta(id, 'late'); runs.finish(id, 'complete'); expect(runs.get(id)).toBeNull(); }
    expect(chats.list()).toEqual([]); expect(projects.get(project.id)).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
