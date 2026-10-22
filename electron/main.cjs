const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const chatgptAuth = require('./chatgpt-auth.cjs');
const chatgptInference = require('./chatgpt-inference.cjs');

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
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
