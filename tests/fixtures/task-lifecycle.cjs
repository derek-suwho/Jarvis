const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createTaskCoordinator } = require('../../electron/tasks/coordinator.cjs');
const { registerTaskIpc } = require('../../electron/tasks/ipc.cjs');

app.setPath('userData', process.env.JARVIS_TASK_TEST_DIR);
let current;
const attempts = [];
const runtime = createTaskCoordinator({
  emit: (event) => { if (current && !current.isDestroyed()) current.webContents.send('tasks:event', event); },
  openAttempt(input, emit) {
    let resolve;
    const item = { input, emit, interrupts: 0, stops: 0, finish: (result) => resolve(result) };
    attempts.push(item);
    return { settled: new Promise((r) => { resolve = r; }),
      interrupt() { item.interrupts++; },
      stop() { item.stops++; resolve({ kind: 'interrupted' }); } };
  },
});
let readyCount = 0;
registerTaskIpc(ipcMain, runtime, {
  isTrusted: (event) => current && event.sender === current.webContents && event.senderFrame === event.sender.mainFrame,
  notifications: { setPreferences() {}, forgetTarget() {} },
  ready: (sender) => { readyCount++; sender.send('tasks:open-target', { kind: 'chat', id: 'persist', generation: 'persist', ephemeral: false }); },
});
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><html><body>Task bridge fixture</body></html>');
});
const evaluate = (code) => current.webContents.executeJavaScript(code);
const request = (id, ephemeral = false) => ({ requestId: `send-${id}`,
  target: { kind: 'chat', id, generation: id, ephemeral }, title: id,
  provider: 'chatgpt', model: 'test', modelLabel: 'Test', instructions: '', history: [],
  input: { id: `u-${id}`, role: 'user', content: 'Test prompt' } });

async function createWindow(origin) {
  current = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../../electron/preload.cjs'), sandbox: true,
    contextIsolation: true, nodeIntegration: false,
  } });
  const ownerId = current.webContents.id;
  current.on('closed', () => runtime.destroyOwner(ownerId));
  await current.loadURL(origin);
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await createWindow(origin);
    const start = await evaluate(`window.jarvis.tasks.start(${JSON.stringify(request('persist'))})`);
    assert.equal(start.ok, true);
    const taskId = start.task.id;
    attempts[0].emit({ type: 'delta', text: 'Saved partial' });
    await evaluate(`window.jarvis.tasks.queue(${JSON.stringify({ taskId, entryId: 'q', message: { id: 'q', role: 'user', content: 'Queued instruction' } })})`);
    assert.equal(attempts[0].interrupts, 0);
    await evaluate(`window.jarvis.tasks.start(${JSON.stringify(request('private', true))})`);
    current.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(attempts[0].stops, 0);
    assert.equal(attempts[1].stops, 1);
    await createWindow(origin);
    const restored = await evaluate('window.jarvis.tasks.snapshot()');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].messages.find((m) => m.role === 'assistant').content, 'Saved partial');
    await evaluate(`window.jarvis.tasks.interrupt(${JSON.stringify(taskId)})`);
    assert.equal(attempts[0].interrupts, 1);
    attempts[0].finish({ kind: 'interrupted', continuation: { checkpoint: true } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(attempts.length, 3);
    assert.equal(attempts[2].input.updates[0].content, 'Queued instruction');
    attempts[2].emit({ type: 'delta', text: 'Resumed result' });
    attempts[2].finish({ kind: 'complete', continuation: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await evaluate('window.jarvis.tasks.snapshot()'))[0].state, 'complete');
    await evaluate('window.openedTarget = null; window.jarvis.tasks.onOpenTarget(target => { window.openedTarget = target; }); window.jarvis.tasks.ready()');
    assert.equal(readyCount, 1);
    assert.equal((await evaluate('window.openedTarget')).id, 'persist');
    await evaluate(`window.jarvis.tasks.forgetTarget(${JSON.stringify(request('persist').target)})`);
    attempts[0].emit({ type: 'delta', text: 'late' });
    assert.deepEqual(await evaluate('window.jarvis.tasks.snapshot()'), []);
    const fresh = createTaskCoordinator({ openAttempt() { throw new Error('Restart must not call a provider'); } });
    assert.deepEqual(fresh.snapshot(), []);
    console.log('PASS: real Electron preload; concurrent ownership; queue/interrupt; window recreation; ephemeral cleanup; ready routing; delete fencing; no automatic restart. Fake providers only.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    server.close();
  }
});
