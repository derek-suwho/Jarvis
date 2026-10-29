import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

function desktop() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const app = Object.assign(new EventEmitter(), {
    userAgentFallback: 'Chrome Electron/44 jarvis/1',
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
  });
  const windows: any[] = [];
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      id: windows.length + 1, mainFrame: {},
      setWindowOpenHandler: vi.fn(), send: vi.fn(),
    });
    constructor() { super(); windows.push(this); }
    loadFile = vi.fn();
    loadURL = vi.fn();
    isDestroyed = () => false;
  }
  const ipcMain = { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), on: vi.fn() };
  function adapter(provider: string) {
    const status = vi.fn(async () => ({ installed: true, connected: false }));
    return {
      status, openAttempt: vi.fn(() => ({ settled: Promise.resolve({ kind: 'complete' }), stop: vi.fn() })),
      shutdown: vi.fn(),
      registerIpc: (ipc: typeof ipcMain) => ipc.handle(`${provider}:status`, status),
    };
  }
  const gemini = adapter('gemini');
  const grok = adapter('grok');
  const runtime = { shutdown: vi.fn() };
  let coordinator: any;
  const modules: Record<string, any> = {
    electron: { app, BrowserWindow: Window, Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
      Notification: {}, dialog: {}, ipcMain, nativeTheme: {}, shell: {} },
    './chatgpt-auth.cjs': { registerIpc: vi.fn() },
    './chatgpt-inference.cjs': { registerIpc: vi.fn() },
    './claude-code.cjs': { registerIpc: vi.fn() },
    './gemini-cli.cjs': gemini,
    './grok-cli.cjs': grok,
    './subscription-stream.cjs': require('../electron/subscription-stream.cjs'),
    './tools/index.cjs': { registerIpc: vi.fn() },
    './tasks/coordinator.cjs': { createTaskCoordinator: (options: any) => { coordinator = options; return runtime; } },
    './tasks/notifications.cjs': { createTaskNotifications: () => ({}) },
    './tasks/ipc.cjs': { registerTaskIpc: vi.fn() },
    './tasks/preview.cjs': { openPreviewAttempt: vi.fn() },
  };
  vm.runInNewContext(readFileSync(path.join(root, 'electron/main.cjs'), 'utf8'), {
    require: (id: string) => modules[id] ?? require(id),
    __dirname: path.join(root, 'electron'), process: { platform: 'darwin', env: {} },
    setTimeout, clearTimeout,
  });
  return { handlers, app, gemini, grok, windows, runtime, getCoordinator: () => coordinator };
}

describe('subscription desktop integration', () => {
  it('allows account checks only from the app main frame', async () => {
    const f = desktop();
    await Promise.resolve();
    const sender = f.windows[0].webContents;
    for (const provider of ['gemini', 'grok'] as const) {
      const handler = f.handlers.get(`${provider}:status`)!;
      expect(() => handler({ sender, senderFrame: {} })).toThrow('Untrusted');
      expect(() => handler({ sender: { mainFrame: {} }, senderFrame: sender.mainFrame })).toThrow('Untrusted');
      expect(f[provider].status).not.toHaveBeenCalled();
      expect(await handler({ sender, senderFrame: sender.mainFrame })).toEqual({ installed: true, connected: false });
      expect(f[provider].status).toHaveBeenCalledOnce();
    }
  });

  it('routes both task providers to their native adapter and shuts them down on quit', async () => {
    const f = desktop();
    await Promise.resolve();
    const emit = vi.fn();
    for (const provider of ['gemini', 'grok'] as const) {
      const input = { provider, request: { model: `${provider}-default` }, updates: [{ role: 'user', content: 'Queued' }] };
      f.getCoordinator().openAttempt(input, emit);
      expect(f[provider].openAttempt).toHaveBeenCalledExactlyOnceWith(input, emit);
    }
    let release!: () => void;
    f.gemini.shutdown.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const event = { preventDefault: vi.fn() };
    f.app.emit('before-quit', event);
    f.app.emit('before-quit', event);
    expect(f.runtime.shutdown).toHaveBeenCalledOnce();
    expect(f.gemini.shutdown).toHaveBeenCalledOnce();
    expect(f.grok.shutdown).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(f.app.quit).not.toHaveBeenCalled();
    release();
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(f.app.quit).toHaveBeenCalledOnce();
    event.preventDefault.mockClear();
    f.app.emit('before-quit', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('exposes provider-scoped preload calls and disposes stream listeners', async () => {
    let exposed: any;
    const ipcRenderer = Object.assign(new EventEmitter(), { invoke: vi.fn(async () => ({ ok: true })) });
    vm.runInNewContext(readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8'), {
      require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name: string, value: any) => { exposed = value; } } }),
      process: { platform: 'darwin' },
    });
    for (const provider of ['gemini', 'grok']) {
      const bridge = exposed[provider];
      for (const [method, channel] of [['status', 'status'], ['signIn', 'sign-in'], ['cancel', 'cancel'], ['signOut', 'sign-out']]) {
        await bridge[method]();
        expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(`${provider}:${channel}`);
      }
      const payload = { model: `${provider}-default`, messages: [{ role: 'user', content: 'Hello' }] };
      await bridge.stream('request-1', payload);
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(`${provider}:stream`, 'request-1', payload);
      await bridge.abort('request-1');
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(`${provider}:abort`, 'request-1');
      const listener = vi.fn();
      const off = bridge.onStreamEvent(listener);
      ipcRenderer.emit(`${provider}:stream-event`, {}, 'request-1', { type: 'delta', text: 'Hello' });
      expect(listener).toHaveBeenCalledExactlyOnceWith('request-1', { type: 'delta', text: 'Hello' });
      off();
      expect(ipcRenderer.listenerCount(`${provider}:stream-event`)).toBe(0);
    }
  });
});
