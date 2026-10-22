const { contextBridge, ipcRenderer } = require('electron');

// The only desktop capabilities the renderer gets.
contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // ChatGPT account: status and sign-in/out only. Tokens stay in the main process.
  chatgpt: {
    status: () => ipcRenderer.invoke('chatgpt:status'),
    signIn: () => ipcRenderer.invoke('chatgpt:sign-in'),
    cancel: () => ipcRenderer.invoke('chatgpt:cancel'),
    signOut: () => ipcRenderer.invoke('chatgpt:sign-out'),
  },
});
