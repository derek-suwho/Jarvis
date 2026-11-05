import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const { registerCheckpointIpc } = createRequire(import.meta.url)('../electron/checkpoints.cjs');

it('round-trips three historical 10 MiB attachments through the bounded IPC bridge', () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  let durable: unknown = null;
  const store = { save: vi.fn((value) => { durable = value; }), load: () => durable };
  registerCheckpointIpc({ handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) }, store);
  const data = Buffer.alloc(10 * 1024 * 1024, 97).toString('base64');
  const archive = [{ id: 'chat', title: 'Media', updatedAt: 1, messages: Array.from({ length: 3 }, (_, i) => ({
    id: String(i), role: 'user', content: 'Inspect', attachments: [
      { id: String(i), name: 'file.pdf', type: 'application/pdf', size: 10 * 1024 * 1024, data },
    ],
  })) }];
  expect(handlers.get('checkpoints:save')!({}, JSON.stringify(archive))).toBe(true);
  expect(handlers.get('checkpoints:load')!({})).toEqual(archive);
  const oversized = [{ ...archive[0], messages: [{ ...archive[0].messages[0], attachments: [
    { ...archive[0].messages[0].attachments[0], data: 'a'.repeat(32 * 1024 * 1024 + 1) },
  ] }] }];
  expect(() => handlers.get('checkpoints:save')!({}, JSON.stringify(oversized))).toThrow('Invalid checkpoint archive.');
  expect(store.save).toHaveBeenCalledOnce();
  const tooMany = [{ ...archive[0], messages: Array.from({ length: 5 }, () => archive[0].messages[0]) }];
  expect(() => handlers.get('checkpoints:save')!({}, JSON.stringify(tooMany))).toThrow('Invalid checkpoint archive.');
  expect(store.save).toHaveBeenCalledOnce();
  durable = tooMany;
  expect(() => handlers.get('checkpoints:load')!({})).toThrow('Invalid checkpoint archive.');
  durable = oversized;
  expect(() => handlers.get('checkpoints:load')!({})).toThrow('Invalid checkpoint archive.');
});

it('restores legacy image histories without transporting reconstructible previews or mutating stored data', () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const data = Buffer.alloc(10 * 1024 * 1024, 97).toString('base64');
  const preview = `data:image/png;base64,${data}`;
  const archive = [{ id: 'legacy', title: 'Images', updatedAt: 1, messages: Array.from({ length: 3 }, (_, i) => ({
    id: String(i), role: 'user', content: 'Inspect', attachments: [
      { id: String(i), name: 'image.png', type: 'image/png', size: 10 * 1024 * 1024, data, preview },
    ],
  })) }];
  registerCheckpointIpc({ handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) }, {
    load: () => archive, save: vi.fn(),
  });
  const restored = handlers.get('checkpoints:load')!({});
  expect(restored).toEqual(archive.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m,
    attachments: m.attachments.map(({ preview: _preview, ...a }) => a),
  })) })));
  expect(archive[0].messages[0].attachments[0].preview).toBe(preview);
});
