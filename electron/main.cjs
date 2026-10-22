const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

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
    backgroundColor: '#212121',
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
