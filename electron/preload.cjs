const { contextBridge, ipcRenderer } = require('electron');

function subscriptionProvider(provider) {
  return {
    status: () => ipcRenderer.invoke(`${provider}:status`),
    signIn: () => ipcRenderer.invoke(`${provider}:sign-in`),
    cancel: () => ipcRenderer.invoke(`${provider}:cancel`),
    signOut: () => ipcRenderer.invoke(`${provider}:sign-out`),
    stream: (requestId, payload) => ipcRenderer.invoke(`${provider}:stream`, requestId, payload),
    abort: (requestId) => ipcRenderer.invoke(`${provider}:abort`, requestId),
    onStreamEvent: (listener) => {
      const handler = (_event, requestId, message) => listener(requestId, message);
      ipcRenderer.on(`${provider}:stream-event`, handler);
      return () => ipcRenderer.removeListener(`${provider}:stream-event`, handler);
    },
  };
}

// The only desktop capabilities the renderer gets.
contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  platform: process.platform,
  gemini: subscriptionProvider('gemini'),
  grok: subscriptionProvider('grok'),
  tasks: {
    start: (input) => ipcRenderer.invoke('tasks:start', input),
    queue: (input) => ipcRenderer.invoke('tasks:queue', input),
    removeQueued: (input) => ipcRenderer.invoke('tasks:removeQueued', input),
    interrupt: (id) => ipcRenderer.invoke('tasks:interrupt', id),
    stop: (id) => ipcRenderer.invoke('tasks:stop', id),
    snapshot: () => ipcRenderer.invoke('tasks:snapshot'),
    ack: (input) => ipcRenderer.invoke('tasks:ack', input),
    forgetTarget: (target) => ipcRenderer.invoke('tasks:forgetTarget', target),
    detach: (ids) => ipcRenderer.invoke('tasks:detach', ids),
    markRead: (id) => ipcRenderer.invoke('tasks:markRead', id),
    setVisibleTargets: (targets) => ipcRenderer.invoke('tasks:setVisibleTargets', targets),
    setPreferences: (prefs) => ipcRenderer.invoke('tasks:preferences', prefs),
    ready: () => ipcRenderer.invoke('tasks:ready'),
    onEvent: (listener) => {
      const handler = (_event, message) => listener(message);
      ipcRenderer.on('tasks:event', handler);
      return () => ipcRenderer.removeListener('tasks:event', handler);
    },
    onOpenTarget: (listener) => {
      const handler = (_event, target) => listener(target);
      ipcRenderer.on('tasks:open-target', handler);
      return () => ipcRenderer.removeListener('tasks:open-target', handler);
    },
  },
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
    signOut: () => ipcRenderer.invoke('claude:sign-out'),
    stream: (requestId, payload) => ipcRenderer.invoke('claude:stream', requestId, payload),
    abort: (requestId) => ipcRenderer.invoke('claude:abort', requestId),
    onStreamEvent: (listener) => {
      const handler = (_event, requestId, msg) => listener(requestId, msg);
      ipcRenderer.on('claude:stream-event', handler);
      return () => ipcRenderer.removeListener('claude:stream-event', handler);
    },
  },
  // Tools layer: MCP servers and skills imported from Claude and ChatGPT. Secrets stay in the main process.
  tools: {
    state: () => ipcRenderer.invoke('tools:state'),
    scan: () => ipcRenderer.invoke('tools:scan'),
    import: (ids) => ipcRenderer.invoke('tools:import', ids),
    setEnabled: (id, enabled) => ipcRenderer.invoke('tools:set-enabled', id, enabled),
    removeServer: (id) => ipcRenderer.invoke('tools:remove-server', id),
    removeSkill: (id) => ipcRenderer.invoke('tools:remove-skill', id),
    signIn: (id) => ipcRenderer.invoke('tools:sign-in', id),
    refresh: () => ipcRenderer.invoke('tools:refresh'),
  },
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
});
