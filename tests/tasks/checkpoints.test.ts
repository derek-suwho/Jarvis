import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { createCheckpointStore } from '../../desktop/storage/checkpoints';
import { recoverInterruptedMessages } from '../../src/lib/taskProjection';
import { buildReplyHistory } from '../../src/lib/replyContext';
import type { Chat } from '../../src/shared/chatTypes';
import { openDesktopStorage } from '../../desktop/runtime';

it('purges deleted-project checkpoint history and moved-chat turns across restart', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-delete-'));
  const path = join(dir, 'chat.db');
  let storage = openDesktopStorage(path);
  try {
    const turn = (attempt: string, chatId: string, projectId: string) => {
      const run = storage.beginShippingTurn({ requestId: attempt, chatId, text: 'Private input',
        model: { providerId: 'claude', modelId: 'test' } }, { id: projectId, name: projectId });
      storage.runs.finish(run.id, 'complete');
    };
    turn('old-attempt', 'moved', 'deleted');
    turn('kept-attempt', 'moved', 'kept');
    turn('owned-attempt', 'owned', 'deleted');
    const kept: Chat = { id: 'unrelated', title: 'Keep', updatedAt: 1, messages: [] };
    const moved: Chat = { id: 'moved', projectId: 'kept', title: 'Private title', updatedAt: 2, messages: [
      { id: 'old-user', role: 'user', content: 'Private input', attemptId: 'old-attempt' },
      { id: 'old-reply', role: 'assistant', content: 'Private reply', attemptId: 'old-attempt' },
      { id: 'new-user', role: 'user', content: 'Keep input', attemptId: 'kept-attempt' },
    ] };
    storage.checkpoints.save([kept, moved,
      { id: 'owned', title: 'Stale renderer scope', updatedAt: 1, messages: [] },
      { id: 'local-only', projectId: 'deleted', title: 'Not dispatched yet', updatedAt: 1, messages: [] },
    ]);
    await storage.projects.delete('deleted');
    await storage.close(); storage = openDesktopStorage(path);
    expect(storage.checkpoints.load()).toEqual([kept,
      { ...moved, title: 'New chat', messages: [moved.messages[2]] },
    ]);
    expect(storage.chats.get('moved')?.chat.projectId).toBe('kept');
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('reopens renderer checkpoints with task ownership and preserves partial context for a provider switch', () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-test-'));
  const path = join(dir, 'chat.db');
  let db = openDatabase(path);
  try {
    const chats: Chat[] = [{ id: 'chat', title: 'Switch providers', updatedAt: 1, messages: [
      { id: 'user', role: 'user', content: 'Compare options' },
      { id: 'reply', role: 'assistant', content: 'A is faster', model: 'ChatGPT', taskId: 'lost', attemptId: 'old',
        tools: [{ id: 'tool', server: 'local', tool: 'search', status: 'running' }] },
      { id: 'queued', role: 'user', content: 'Unsent instruction', taskId: 'lost', delivery: 'queued' },
    ] }];
    const store = createCheckpointStore(db);
    expect(store.load()).toBeNull(); // Distinguish first launch from an intentionally empty archive.
    store.save([...chats, { id: 'private', title: 'Temporary', updatedAt: 2, temporary: true, messages: [] }]);
    db.close(); db = openDatabase(path);
    const restored = createCheckpointStore(db).load()!;
    expect(restored).toEqual(chats);
    const recovered = recoverInterruptedMessages(restored, []);
    expect(recovered[0].messages[1].tools?.[0].status).toBe('error');
    expect(buildReplyHistory([...recovered[0].messages, { id: 'next', role: 'user', content: 'Claude, continue' }])).toEqual([
      { role: 'user', content: 'Compare options' },
      { role: 'assistant', content: '[Incomplete interrupted response]\nA is faster' },
      { role: 'user', content: 'Claude, continue' },
    ]);
    createCheckpointStore(db).save([]);
    db.close(); db = openDatabase(path);
    expect(createCheckpointStore(db).load()).toEqual([]);
  } finally {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('reports malformed stored checkpoints without exposing private archive content or partially deleting a chat', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-corrupt-'));
  const path = join(dir, 'chat.db');
  let storage = openDesktopStorage(path);
  const chat = storage.chats.create(null);
  await storage.close();
  const db = openDatabase(path);
  const corrupt = '{"private-note":"Sensitive project evidence", broken';
  db.prepare('INSERT INTO renderer_checkpoint(id, chats_json) VALUES (1, ?)').run(corrupt);
  db.close();
  storage = openDesktopStorage(path);
  try {
    expect(() => storage.checkpoints.load()).toThrow('Stored checkpoint archive is invalid.');
    expect(() => storage.chats.delete(chat.id)).toThrow('Stored checkpoint archive is invalid.');
    expect(storage.chats.get(chat.id)).not.toBeNull();
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


it('rejects structurally corrupt JSON checkpoints and preserves deletion state for recovery', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-shape-'));
  const path = join(dir, 'chat.db');
  let storage = openDesktopStorage(path);
  const chat = storage.chats.create(null);
  await storage.close();
  const db = openDatabase(path);
  const corrupt = JSON.stringify([{ id: chat.id, title: 'Private evidence', updatedAt: 1,
    messages: [{ id: 'broken', role: 'assistant', content: { private: 'Sensitive evidence' } }] }]);
  db.prepare('INSERT INTO renderer_checkpoint(id, chats_json) VALUES (1, ?)').run(corrupt);
  db.close();
  storage = openDesktopStorage(path);
  try {
    expect(() => storage.checkpoints.load()).toThrow('Stored checkpoint archive is invalid.');
    expect(() => storage.chats.delete(chat.id)).toThrow('Stored checkpoint archive is invalid.');
    expect(storage.chats.get(chat.id)).not.toBeNull();
    const inspection = openDatabase(path);
    try {
      expect(inspection.prepare('SELECT chats_json FROM renderer_checkpoint WHERE id = 1').get()).toEqual({ chats_json: corrupt });
    } finally { inspection.close(); }
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects invalid checkpoint saves without overwriting the last recoverable archive', () => {
  const db = openDatabase(':memory:');
  try {
    const store = createCheckpointStore(db);
    const previous: Chat[] = [{ id: 'kept', title: 'Last good archive', updatedAt: 1, messages: [] }];
    store.save(previous);
    const invalid = [{ id: 'broken', title: 'Private new content', updatedAt: NaN, messages: [] }];
    expect(() => store.save(invalid)).toThrow('Stored checkpoint archive is invalid.');
    expect(store.load()).toEqual(previous);
  } finally { db.close(); }
});
