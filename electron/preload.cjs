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
  // Claude via the user's own Claude Code CLI; sign-in happens in Claude Code, never in Jarvis.
  claude: {
    status: () => ipcRenderer.invoke('claude:status'),
    signIn: () => ipcRenderer.invoke('claude:sign-in'),
    stream: (requestId, payload) => ipcRenderer.invoke('claude:stream', requestId, payload),
    abort: (requestId) => ipcRenderer.invoke('claude:abort', requestId),
    onStreamEvent: (listener) => {
      const handler = (_event, requestId, msg) => listener(requestId, msg);
      ipcRenderer.on('claude:stream-event', handler);
      return () => ipcRenderer.removeListener('claude:stream-event', handler);
    },
  },
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
});
