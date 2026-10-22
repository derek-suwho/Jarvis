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
    models: () => ipcRenderer.invoke('chatgpt:models'),
    stream: (requestId, payload) => ipcRenderer.invoke('chatgpt:stream', requestId, payload),
    abort: (requestId) => ipcRenderer.invoke('chatgpt:abort', requestId),
    onStreamEvent: (listener) => {
      const handler = (_event, requestId, msg) => listener(requestId, msg);
      ipcRenderer.on('chatgpt:stream-event', handler);
      return () => ipcRenderer.removeListener('chatgpt:stream-event', handler);
    },
  },
});
