import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import type { Chat } from '../src/shared/chatTypes';

vi.mock('../src/lib/mediaStore', () => ({ readMedia: vi.fn(async () => []), writeMedia: vi.fn(), pruneMedia: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const legacy: Chat[] = [{ id: 'legacy', title: 'Legacy', updatedAt: 1, messages: [] }];
function setup(load: () => Promise<Chat[] | null>, save = vi.fn(async (_chats: Chat[]) => true)) {
  const local = new Map([['jarvis.chats', JSON.stringify(legacy)]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => local.get(key) ?? null, setItem: vi.fn() });
  vi.stubGlobal('window', { jarvis: { checkpoints: { load, save } } });
  return save;
}

it('restores desktop history before render and waits for the durable save receipt with attachment bytes', async () => {
  const archive: Chat[] = [{ id: 'sqlite', title: 'Switch', updatedAt: 2, messages: [
    { id: 'u', role: 'user', content: 'Look', attachments: [{ id: 'img', name: 'map.png', size: 1, type: 'image/png', data: 'YQ==' }] },
    { id: 'a', role: 'assistant', content: 'Partial', model: 'Claude', taskId: 'task', attemptId: 'attempt' },
  ] }];
  let complete!: (value: boolean) => void;
  const save = setup(async () => archive, vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; })));
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  expect(chats.loadChats()).toEqual(archive.map((chat) => ({ ...chat, messages: chat.messages.map((message) => ({ ...message,
    ...(message.attachments ? { attachments: message.attachments.map((a) => ({ ...a, preview: 'data:image/png;base64,YQ==' })) } : {}),
  })) })));
  let durable = false;
  const receipt = chats.saveChats([...archive, { ...legacy[0], temporary: true }]).then(() => { durable = true; });
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith(archive);
  expect(durable).toBe(false);
  complete(true);
  await receipt;
  expect(durable).toBe(true);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('keeps an intentionally empty desktop archive empty instead of reviving legacy history', async () => {
  setup(async () => []);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  expect(chats.loadChats()).toEqual([]);
});

it('migrates legacy history only on first launch and blocks writes after a failed restore', async () => {
  const save = setup(async () => null);
  let chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  expect(chats.loadChats()).toEqual(legacy);
  await chats.saveChats(chats.loadChats());
  expect(save).toHaveBeenCalledWith(legacy);
  vi.resetModules();
  setup(async () => { throw new Error('disk unavailable'); }, save);
  chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const errors: string[] = [];
  chats.subscribeToChatStorageErrors((message) => errors.push(message));
  await expect(chats.saveChats([])).rejects.toThrow();
  expect(save).toHaveBeenCalledTimes(1);
  expect(errors.join(' ')).toMatch(/restore/);
});

it('orders checkpoint maintenance after prior writes and before later writes without coalescing across deletion', async () => {
  let finishFirst!: (value: boolean) => void;
  let finishDelete!: () => void;
  const events: string[] = [];
  setup(async () => [], vi.fn(async (rows: Chat[]) => {
    events.push(rows[0]?.id ?? 'empty');
    if (rows[0]?.id === 'before') await new Promise<boolean>((resolve) => { finishFirst = resolve; });
    return true;
  }));
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const before = chats.saveChats([{ ...legacy[0], id: 'before' }]);
  const deletion = chats.withChatCheckpointBarrier(async () => {
    events.push('delete');
    await new Promise<void>((resolve) => { finishDelete = resolve; });
  });
  const after = chats.saveChats([{ ...legacy[0], id: 'after' }]);
  await vi.waitFor(() => expect(events).toEqual(['before']));
  finishFirst(true);
  await before;
  await vi.waitFor(() => expect(events).toEqual(['before', 'delete']));
  finishDelete();
  await Promise.all([deletion, after]);
  expect(events).toEqual(['before', 'delete', 'after']);
});

it('reports failed checkpoint maintenance and continues processing later saves', async () => {
  const save = setup(async () => []);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const maintenance = chats.withChatCheckpointBarrier(async () => { throw new Error('delete failed'); });
  const saved = chats.saveChats(legacy);
  await expect(maintenance).rejects.toThrow('delete failed');
  await saved;
  expect(save).toHaveBeenCalledWith(legacy);
});

it('reloads authoritative desktop history after destructive maintenance before exposing it to the renderer', async () => {
  const privateChat: Chat = { id: 'moved', projectId: 'kept', title: 'Private title', updatedAt: 1,
    messages: [{ id: 'old', role: 'user', content: 'Deleted project evidence' }, { id: 'safe', role: 'user', content: 'Keep' }] };
  let archive = [privateChat];
  const load = vi.fn(async () => structuredClone(archive));
  setup(load);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  expect(chats.loadChats()).toEqual([privateChat]);
  const reconciled = [{ ...privateChat, title: 'New chat', messages: [privateChat.messages[1]] }];
  await chats.reconcileChatCheckpoint(async () => { archive = reconciled; });
  expect(load).toHaveBeenCalledTimes(2);
  expect(chats.loadChats()).toEqual(reconciled);
});

it('blocks stale checkpoints after deletion mutates storage then fails, and recovers through authoritative retry', async () => {
  let archive = legacy;
  const save = setup(async () => structuredClone(archive));
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  await expect(chats.reconcileChatCheckpoint(async () => {
    archive = [];
    throw new Error('receipt lost after deletion');
  })).rejects.toThrow('receipt lost after deletion');
  await expect(chats.saveChats(legacy)).rejects.toThrow('restore');
  expect(save).not.toHaveBeenCalled();
  expect(chats.loadChats()).toEqual([]);
  await chats.reconcileChatCheckpoint(async () => {});
  expect(chats.loadChats()).toEqual([]);
  await chats.saveChats([]);
  expect(save).toHaveBeenCalledExactlyOnceWith([]);
});

it('does not fill missing authoritative desktop media from a different attachment with the same ID', async () => {
  const file = { id: 'reused', name: 'file.png', type: 'image/png', size: 1 };
  const archive: Chat[] = [{ id: 'desktop', title: 'Restored', updatedAt: 1, messages: [
    { id: 'old', role: 'user', content: 'Old file', attachments: [{ ...file, data: 'YQ==' }] },
    { id: 'missing', role: 'user', content: 'Unavailable file', attachments: [{ ...file }] },
  ] }];
  setup(async () => archive);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const restored = chats.loadChats();
  expect(restored[0].messages[0].attachments?.[0].data).toBe('YQ==');
  expect(restored[0].messages[1].attachments?.[0]).toEqual(file);
});


it('saves three 10 MiB images through desktop IPC without duplicate previews and restores their previews', async () => {
  const { registerCheckpointIpc } = createRequire(import.meta.url)('../electron/checkpoints.cjs');
  const handlers = new Map<string, (...args: any[]) => any>();
  let durable: Chat[] = [];
  registerCheckpointIpc({ handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) }, {
    load: () => durable, save: (rows: Chat[]) => { durable = rows; },
  });
  const save = setup(async () => durable, vi.fn(async (rows: Chat[]) =>
    handlers.get('checkpoints:save')!({}, JSON.stringify(rows))));
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const data = Buffer.alloc(10 * 1024 * 1024, 97).toString('base64');
  const preview = `data:image/png;base64,${data}`;
  const archive: Chat[] = [{ id: 'images', title: 'Images', updatedAt: 1, messages: Array.from({ length: 3 }, (_, i) => ({
    id: String(i), role: 'user', content: 'Inspect', attachments: [
      { id: String(i), name: 'image.png', type: 'image/png', size: 10 * 1024 * 1024, data, preview },
    ],
  })) }];
  await expect(chats.saveChats(archive)).resolves.toBeUndefined();
  expect(save).toHaveBeenCalledOnce();
  expect(durable[0].messages.every(m => m.attachments?.[0].preview === undefined)).toBe(true);
  expect(archive[0].messages[0].attachments?.[0].preview).toBe(preview);
  await chats.reconcileChatCheckpoint(async () => {});
  expect(chats.loadChats()).toEqual(archive);
});


it('excludes temporary attachment history before cloning a queued durable checkpoint', async () => {
  const save = setup(async () => []);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const temporary: Chat = { id: 'temporary', title: 'Private', temporary: true, updatedAt: 1,
    messages: [{ id: 'u', role: 'user', content: 'Private', attachments: [
      { id: 'file', name: 'private.pdf', type: 'application/pdf', size: 1024 * 1024, data: 'a'.repeat(1024 * 1024) },
    ] }] };
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    await chats.saveChats([...legacy, temporary]);
    expect(clone).toHaveBeenCalledExactlyOnceWith(legacy);
    expect(save).toHaveBeenCalledExactlyOnceWith(legacy);
    expect(temporary.messages[0].attachments?.[0].data).toHaveLength(1024 * 1024);
  } finally { clone.mockRestore(); }
});

it('omits reconstructible durable image previews before cloning the queued checkpoint', async () => {
  const save = setup(async () => []);
  const chats = await import('../src/lib/chats');
  await chats.initializeChatMedia();
  const data = 'a'.repeat(1024 * 1024);
  const preview = `data:image/png;base64,${data}`;
  const attachment = { id: 'image', name: 'image.png', type: 'image/png', size: 1024 * 1024, data, preview };
  const archive: Chat[] = [{ ...legacy[0], messages: [{ id: 'u', role: 'user', content: 'Look', attachments: [attachment] }] }];
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    await chats.saveChats(archive);
    const captured = clone.mock.calls[0][0] as Chat[];
    expect(captured[0].messages[0].attachments?.[0]).toEqual({ id: 'image', name: 'image.png', type: 'image/png', size: 1024 * 1024, data });
    expect(save).toHaveBeenCalledExactlyOnceWith(captured);
    expect(attachment.preview).toBe(preview);
  } finally { clone.mockRestore(); }
});
