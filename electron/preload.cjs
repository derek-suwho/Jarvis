const { contextBridge, ipcRenderer } = require('electron');

// The only desktop capabilities the renderer gets.
contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
});
