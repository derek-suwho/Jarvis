const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const chatgptAuth = require('./chatgpt-auth.cjs');
const chatgptInference = require('./chatgpt-inference.cjs');
const claudeCode = require('./claude-code.cjs');
const geminiCli = require('./gemini-cli.cjs');
const grokCli = require('./grok-cli.cjs');
const { registerSubscriptionStream } = require('./subscription-stream.cjs');
const tools = require('./tools/index.cjs');
const { createTaskCoordinator } = require('./tasks/coordinator.cjs');
const { createTaskNotifications } = require('./tasks/notifications.cjs');
const { registerTaskIpc } = require('./tasks/ipc.cjs');
const { openPreviewAttempt } = require('./tasks/preview.cjs');
const appWindows = new Set();
const readyWindows = new Set();
let pendingTarget = null;
let taskRuntime;

const focusedApp = () => [...appWindows].some((win) => !win.isDestroyed() && win.isFocused());
const isTrustedSender = (event) => [...appWindows].some((win) => !win.isDestroyed()
  && win.webContents === event.sender && event.senderFrame === event.sender.mainFrame);
function openTaskTarget(target) {
  let win = [...appWindows].find((item) => !item.isDestroyed());
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (readyWindows.has(win.webContents.id)) win.webContents.send('tasks:open-target', target);
  else pendingTarget = target;
}

function isHttpUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Present as plain Chrome so sites like Google serve their normal pages instead of
// treating the embedded browser as an unknown client.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|jarvis)\/\S+/gi, '');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 560,
    title: 'Jarvis',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    // Native-feeling chrome like the ChatGPT/Claude desktop apps: traffic lights float over the sidebar.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  appWindows.add(win);
  const ownerId = win.webContents.id;
  win.webContents.on('did-start-loading', () => {
    readyWindows.delete(ownerId);
    taskRuntime?.destroyOwner(ownerId);
  });
  win.on('closed', () => {
    readyWindows.delete(ownerId);
    appWindows.delete(win);
    taskRuntime?.destroyOwner(ownerId);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // The app window never navigates away from Jarvis; links meant for a new window go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  return win;
}

app.on('web-contents-created', (_event, contents) => {
  // Every <webview> is an untrusted page: no preload, no Node, sandboxed, http(s) only.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!isHttpUrl(params.src)) event.preventDefault();
  });

  if (contents.getType() === 'webview') {
    // target=_blank links open in the same tab instead of spawning windows.
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && isHttpUrl(url)) return shell.openExternal(url);
});

const THEMES = new Set(['system', 'dark', 'light']);
ipcMain.on('set-theme', (event, theme) => {
  if (!THEMES.has(theme)) return;
  nativeTheme.themeSource = theme;
  BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff');
});

const SAVE_TYPES = { '.md': 'Markdown', '.json': 'JSON' };
ipcMain.handle('save-file', async (event, name, content) => {
  if (typeof name !== 'string' || typeof content !== 'string') return false;
  const base = path.basename(name);
  const ext = path.extname(base);
  if (!SAVE_TYPES[ext]) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), base),
    filters: [{ name: SAVE_TYPES[ext], extensions: [ext.slice(1)] }],
  });
  if (canceled || !filePath) return false;
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

function sendCommand(command) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu-command', command);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendCommand('settings') },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendCommand('new-chat') },
        { label: 'Search Chats', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('search') },
        ...(isMac ? [] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: () => sendCommand('settings') }]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('toggle-sidebar') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  chatgptAuth.registerIpc(ipcMain);
  chatgptInference.registerIpc(ipcMain);
  claudeCode.registerIpc(ipcMain);
  const accountIpc = {
    handle: (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted account request.');
      return handler(event, ...args);
    }),
  };
  for (const [provider, adapter] of [['gemini', geminiCli], ['grok', grokCli]]) {
    adapter.registerIpc(accountIpc);
    registerSubscriptionStream(ipcMain, provider, adapter, isTrustedSender);
  }
  tools.registerIpc(ipcMain);
  const notifications = createTaskNotifications({
    isFocused: focusedApp,
    openTarget: openTaskTarget,
    createNotification: (options) => Notification.isSupported() ? new Notification(options) : null,
  });
  taskRuntime = createTaskCoordinator({
    isFocused: focusedApp,
    emit: (event) => {
      for (const win of appWindows) if (!win.isDestroyed()) win.webContents.send('tasks:event', event);
    },
    onOutcome: (task) => notifications.outcome(task),
    openAttempt: (input, emit) => input.provider === 'claude' ? claudeCode.openAttempt(input, emit)
      : input.provider === 'chatgpt' ? chatgptInference.openAttempt(input, emit)
      : input.provider === 'gemini' ? geminiCli.openAttempt(input, emit)
      : input.provider === 'grok' ? grokCli.openAttempt(input, emit) : openPreviewAttempt(input, emit),
  });
  registerTaskIpc(ipcMain, taskRuntime, {
    notifications,
    isTrusted: isTrustedSender,
    ready: (sender) => {
      readyWindows.add(sender.id);
      if (pendingTarget) {
        sender.send('tasks:open-target', pendingTarget);
        pendingTarget = null;
      }
    },
  });
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let providerShutdown = null;
let providersStopped = false;
app.on('before-quit', (event) => {
  if (providersStopped) return;
  event.preventDefault();
  if (providerShutdown) return;
  taskRuntime?.shutdown();
  let deadline;
  const timeout = new Promise((resolve) => { deadline = setTimeout(resolve, 5000); });
  providerShutdown = Promise.race([
    Promise.allSettled([geminiCli.shutdown(), grokCli.shutdown()]),
    timeout,
  ]).finally(() => {
    clearTimeout(deadline);
    providersStopped = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
