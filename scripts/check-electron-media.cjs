const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.setPath('userData', process.argv[2]);
const auth = require('../electron/chatgpt-auth.cjs');
const inference = require('../electron/chatgpt-inference.cjs');
const { createTaskCoordinator } = require('../electron/tasks/coordinator.cjs');
const { registerTaskIpc } = require('../electron/tasks/ipc.cjs');
auth.getAccessToken = async () => 'isolated-test-token';
const captured = [];
global.fetch = async (url, request) => {
  if (url === 'https://api.openai.com/v1/models') {
    return Response.json({ data: [{ id: 'test-vision-model', visibility: 'list' }] });
  }
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(request.headers.Authorization, 'Bearer isolated-test-token');
  captured.push(JSON.parse(request.body));
  return new Response('data: {"type":"response.output_text.delta","delta":"Media delivered"}\n\ndata: {"type":"response.completed"}\n\n');
};

ipcMain.handle('chatgpt:status', () => ({ connected: true, registered: true, email: null }));
ipcMain.handle('claude:status', () => ({ installed: false, connected: false, email: null, plan: null }));
ipcMain.on('set-theme', () => {});
inference.registerIpc(ipcMain);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve('electron/preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  const rendererErrors = [];
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(event.message);
  });
  window.webContents.on('preload-error', (_event, _path, error) => rendererErrors.push(error.message));
  const runtime = createTaskCoordinator({
    emit: (event) => window.webContents.send('tasks:event', event),
    openAttempt: (input, emit) => inference.openAttempt(input, emit, async () => []),
  });
  registerTaskIpc(ipcMain, runtime, {
    isTrusted: (event) => event.sender === window.webContents && event.senderFrame === event.sender.mainFrame,
    notifications: { forgetTarget() {}, setPreferences() {} },
    ready() {},
  });
  await window.loadURL(process.argv[3]);
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2uoAAAAASUVORK5CYII=';
  const pdf = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
  const files = [
    { name: 'screen.png', type: 'image/png', data: image },
    { name: 'report.pdf', type: 'application/pdf', data: pdf },
  ];
  // Submit through the mounted composer, App task client, actual preload, and main coordinator.
  const result = await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (test, label) => {
      const deadline = Date.now() + 8000;
      while (!test()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for ' + label);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    await waitFor(() => document.querySelector('.composer') && document.querySelector('.plan-note'), 'connected composer');
    document.querySelector('.model-trigger').click();
    const choice = () => [...document.querySelectorAll('.model-choice')].find((button) => button.textContent.includes('test-vision-model'));
    await waitFor(choice, 'live model');
    choice().click();
    const textarea = document.querySelector('.chat-pane textarea[aria-label="Message"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, "explain to me what's on this screen");
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const clipboard = new DataTransfer();
    for (const file of ${JSON.stringify(files)}) {
      const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
      clipboard.items.add(new File([bytes], file.name, { type: file.type }));
    }
    textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: clipboard }));
    const send = () => document.querySelector('.chat-pane button[aria-label="Send message"]');
    await waitFor(() => document.querySelectorAll('.composer-files .file-chip').length === 2 && send() && !send().disabled, 'task-ready media draft');
    const task = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Task did not finish')); }, 8000);
      const off = window.jarvis.tasks.onEvent((event) => {
        if (event.type !== 'snapshot') return;
        if (event.task.state === 'complete' || event.task.state === 'failed') {
          clearTimeout(timer);
          off();
          if (event.task.state === 'failed') reject(new Error(event.task.error || 'Task failed'));
          else resolve(event.task);
        }
      });
      send().click();
    });
    await waitFor(() => document.querySelector('.message.assistant')?.textContent.includes('Media delivered'), 'rendered task reply');
    return task;
  })()`);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].input[0], {
    role: 'user', content: [
      { type: 'input_text', text: "explain to me what's on this screen" },
      { type: 'input_text', text: 'Attached image: "screen.png"' },
      { type: 'input_image', image_url: `data:image/png;base64,${image}` },
      { type: 'input_file', filename: 'report.pdf', file_data: `data:application/pdf;base64,${pdf}` },
    ],
  });
  assert.equal(result.state, 'complete');
  assert.equal(result.messages.find((message) => message.role === 'assistant')?.content, 'Media delivered');
  assert.deepEqual(rendererErrors, [], 'The renderer must start tasks without preload or IPC errors');
  assert.equal(await window.webContents.executeJavaScript('!!document.querySelector(".composer")'), true,
    'The actual desktop renderer must remain mounted after its effects run');
  console.log('PASS: mounted composer → task client → Electron preload/IPC → coordinator → Responses preserves image/PDF bytes and renders the completed reply.');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
