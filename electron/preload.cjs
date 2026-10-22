const { contextBridge, ipcRenderer } = require('electron');

// The only desktop capabilities the renderer gets.
contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
