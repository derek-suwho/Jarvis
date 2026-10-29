import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { registerTaskIpc } = require('../../electron/tasks/ipc.cjs');

describe('task IPC boundary', () => {
  it('rejects foreign frames, routes commands and retains commands until renderer ready', async () => {
    const handlers = new Map<string, any>();
    const runtime = { snapshot: vi.fn(() => []), start: vi.fn(() => ({ ok: true })), setVisibleTargets: vi.fn() };
    const notifications = { setPreferences: vi.fn(), forgetTarget: vi.fn() };
    const ready = vi.fn();
    registerTaskIpc({ handle: (name: string, fn: any) => handlers.set(name, fn) }, runtime, {
      isTrusted: (event: any) => event.trusted, notifications, ready,
    });
    expect(() => handlers.get('tasks:snapshot')({ trusted: false })).toThrow(/trusted/i);
    expect(handlers.get('tasks:snapshot')({ trusted: true })).toEqual([]);
    await handlers.get('tasks:start')({ trusted: true, sender: { id: 7 } }, { requestId: 'req' });
    expect(runtime.start).toHaveBeenCalledWith({ requestId: 'req' }, 7);
    handlers.get('tasks:ready')({ trusted: true, sender: { id: 7 } });
    expect(ready).toHaveBeenCalled();
    expect(() => handlers.get('tasks:preferences')({ trusted: true }, { desktopTaskNotifications: 'yes' })).toThrow();
  });
});
