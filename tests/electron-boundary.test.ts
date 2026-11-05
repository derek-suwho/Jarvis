import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const checkpointIpc = require('../electron/checkpoints.cjs');
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

async function boot() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, (...args: any[]) => any>();
  const effects = vi.fn();
  const storage = { projects: { delete: vi.fn() }, close: vi.fn(), checkpoints: { load: vi.fn(), save: vi.fn() } };
  const openDesktopStorage = vi.fn(() => storage);
  const mainFrame = {};
  const sender = { id: 1, mainFrame, on: vi.fn(), setWindowOpenHandler: vi.fn() };
  class Window {
    webContents = sender;
    isDestroyed() { return false; }
    on() {}
    loadFile() {}
    static fromWebContents() { effects(); return { setBackgroundColor: effects }; }
  }
  const electron = {
    app: { userAgentFallback: 'Electron/test', on: vi.fn(), whenReady: () => Promise.resolve(), getPath: () => '/unused', quit: vi.fn() },
    BrowserWindow: Window, Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    Notification: {}, dialog: { showSaveDialog: effects }, nativeTheme: {}, shell: { openExternal: effects },
    ipcMain: {
      handle: (name: string, handler: any) => handlers.set(name, handler),
      on: (name: string, handler: any) => listeners.set(name, handler),
    },
  };
  const registrations = ['chatgpt-auth', 'chatgpt-inference', 'claude-code', 'gemini-cli', 'grok-cli', 'tools/index'];
  const dependencies: Record<string, any> = Object.fromEntries(registrations.map((name) => [`./${name}.cjs`, {
    registerIpc: (ipc: any) => ipc.handle(`${name}:probe`, effects), shutdown: vi.fn(),
  }]));
  dependencies['/app/electron/../dist/backend/storage.cjs'] = { openDesktopStorage };
  dependencies['./subscription-stream.cjs'] = { registerSubscriptionStream: vi.fn() };
  dependencies['./tasks/coordinator.cjs'] = { createTaskCoordinator: () => ({ shutdown: vi.fn() }) };
  dependencies['./tasks/notifications.cjs'] = { createTaskNotifications: () => ({}) };
  dependencies['./tasks/ipc.cjs'] = { registerTaskIpc: (ipc: any) => ipc.handle('tasks:probe', effects) };
  dependencies['./tasks/preview.cjs'] = {};
  dependencies['./projects.cjs'] = require('../electron/projects.cjs');
  vm.runInNewContext(fs.readFileSync('electron/main.cjs', 'utf8'), {
    require: (name: string) => name === 'electron' ? electron : name === 'node:path' ? { join: (...parts: string[]) => parts.join('/'), basename: (s: string) => s, extname: () => '.md' }
      : name === 'node:fs/promises' ? { writeFile: effects } : name === './checkpoints.cjs' ? checkpointIpc : dependencies[name],
    URL, __dirname: '/app/electron', process: { platform: 'linux', env: {} }, setTimeout, clearTimeout,
  });
  await Promise.resolve();
  return { handlers, listeners, effects, sender, mainFrame, app: electron.app, storage, openDesktopStorage };
}

describe('main-process privileged IPC boundary', () => {
  it('rejects foreign windows and subframes on every route before side effects', async () => {
    const { handlers, listeners, effects, sender, mainFrame } = await boot();
    expect(handlers.size).toBe(12);
    for (const [name, handler] of [...handlers, ...listeners]) {
      for (const event of [{ sender: { mainFrame }, senderFrame: mainFrame }, { sender, senderFrame: {} }]) {
        const invoke = () => handler(event, name === 'open-external' ? 'https://example.com' : 'file.md', 'content');
        if (listeners.has(name)) expect(invoke(), name).toBeUndefined();
        else expect(invoke, name).toThrow(/untrusted/i);
      }
    }
    expect(effects).not.toHaveBeenCalled();
  });

  it('preserves trusted main-frame handler results and arguments', async () => {
    const { handlers, effects, sender, mainFrame } = await boot();
    effects.mockReturnValue('accepted');
    const event = { sender, senderFrame: mainFrame };
    expect(handlers.get('chatgpt-auth:probe')!(event, 'payload')).toBe('accepted');
    expect(effects).toHaveBeenCalledWith(event, 'payload');
    expect(handlers.get('open-external')!(event, 'https://example.com')).toBe('accepted');
  });
});


describe('session permission boundary', () => {
  it('denies permission checks and requests for app and isolated webview sessions', async () => {
    const { app } = await boot();
    const created = app.on.mock.calls.find(([name]) => name === 'web-contents-created')![1];
    for (const type of ['window', 'webview']) {
      const session = { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() };
      const contents = { session, on: vi.fn(), getType: () => type, setWindowOpenHandler: vi.fn() };
      created({}, contents);
      expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce();
      expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce();
      const check = session.setPermissionCheckHandler.mock.calls[0][0];
      const request = session.setPermissionRequestHandler.mock.calls[0][0];
      for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'unknown']) {
        expect(check(contents, permission, 'https://example.com', {})).toBe(false);
        const callback = vi.fn();
        request(contents, permission, callback, { requestingUrl: 'https://example.com' });
        expect(callback).toHaveBeenCalledExactlyOnceWith(false);
      }
    }
  });
});


describe('desktop checkpoint storage lifecycle', () => {
  it('opens the built backend in private app data and closes it on quit', async () => {
    const { app, storage, openDesktopStorage } = await boot();
    expect(openDesktopStorage).toHaveBeenCalledExactlyOnceWith('/unused/jarvis.sqlite', { getAdapter: expect.any(Function) });
    expect(storage.close).not.toHaveBeenCalled();
    let release!: () => void;
    storage.close.mockReturnValue(new Promise<void>(resolve => { release = resolve; }) as any);
    const quit = app.on.mock.calls.find(([name]) => name === 'before-quit')![1];
    quit({ preventDefault: vi.fn() });
    expect(storage.close).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    release();
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});

 describe('trusted checkpoint IPC', () => {
  it('round-trips saved conversations and rejects malformed archives before storage', async () => {
    const { handlers, storage, sender, mainFrame } = await boot();
    const event = { sender, senderFrame: mainFrame };
    const chats = [{ id: 'chat', title: 'Switch', updatedAt: 1, messages: [{ id: 'm', role: 'assistant', content: 'Kept', model: 'Claude', taskId: 'task', attemptId: 'attempt' }] }];
    const save = handlers.get('checkpoints:save');
    expect(save).toBeTypeOf('function');
    expect(save!(event, JSON.stringify(chats))).toBe(true);
    expect(storage.checkpoints.save).toHaveBeenCalledExactlyOnceWith(chats);
    storage.checkpoints.load.mockReturnValue(chats);
    expect(handlers.get('checkpoints:load')!(event)).toEqual(chats);
    for (const invalid of [null, chats, '{}', '[null]', JSON.stringify([{ ...chats[0], messages: [null] }]), 'x'.repeat(32 * 1024 * 1024 + 1)]) {
      expect(() => save!(event, invalid)).toThrow(/invalid checkpoint/i);
    }
    expect(storage.checkpoints.save).toHaveBeenCalledOnce();
  });
});
