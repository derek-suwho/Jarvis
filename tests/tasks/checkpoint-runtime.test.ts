import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { createCheckpointStore } from '../../desktop/storage/checkpoints';
import { recoverInterruptedMessages } from '../../src/lib/taskProjection';
import { buildReplyHistory } from '../../src/lib/replyContext';
import type { Chat } from '../../src/shared/chatTypes';

vi.mock('../../src/lib/mediaStore', () => ({ readMedia: vi.fn(async () => []), writeMedia: vi.fn(), pruneMedia: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('acknowledges an isolated renderer snapshot and recovers the last durable context after a failed save and restart', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-runtime-'));
  const path = join(dir, 'chat.db');
  let db = openDatabase(path);
  let failSave = false;
  const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2uoAAAAASUVORK5CYII=';
  const bind = () => {
    const store = createCheckpointStore(db);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('window', { jarvis: { checkpoints: {
      load: async () => store.load(),
      save: async (chats: Chat[]) => {
        if (failSave) throw new Error('disk full');
        store.save(chats);
        return true;
      },
    } } });
  };
  try {
    bind();
    let renderer = await import('../../src/lib/chats');
    await renderer.initializeChatMedia();
    const archive: Chat[] = [{ id: 'chat', title: 'Switch', updatedAt: 1, messages: [
      { id: 'u', role: 'user', content: 'Compare options', attachments: [
        { id: 'image', name: 'map.png', type: 'image/png', size: 68, data: imageData },
      ] },
      { id: 'a', role: 'assistant', content: 'A is faster', model: 'ChatGPT', taskId: 'lost', attemptId: 'old' },
    ] }];
    const receipt = renderer.saveChats(archive);
    // The caller may change state before the queued write begins.
    archive[0].messages[1].content = 'Unacknowledged mutation';
    await receipt;
    expect(createCheckpointStore(db).load()![0].messages[1].content).toBe('A is faster');

    const errors: string[] = [];
    renderer.subscribeToChatStorageErrors((message) => errors.push(message));
    failSave = true;
    await expect(renderer.saveChats(archive)).rejects.toThrow('disk full');
    expect(errors).toHaveLength(1);
    expect(renderer.loadChats()[0].messages[1].content).toBe('A is faster');

    db.close();
    db = openDatabase(path);
    vi.resetModules();
    bind();
    renderer = await import('../../src/lib/chats');
    await renderer.initializeChatMedia();
    const recovered = recoverInterruptedMessages(renderer.loadChats(), []);
    const context = buildReplyHistory([...recovered[0].messages,
      { id: 'next', role: 'user', content: 'Claude, continue' },
    ]);
    expect(context).toEqual([
      { role: 'user', content: 'Compare options', media: [{ name: 'map.png', type: 'image/png', data: imageData }] },
      { role: 'assistant', content: '[Incomplete interrupted response]\nA is faster' },
      { role: 'user', content: 'Claude, continue' },
    ]);
    failSave = false;
    await renderer.saveChats(recovered);
    expect(createCheckpointStore(db).load()![0].messages[1].outcome).toBe('interrupted');
  } finally {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
