function registerTaskIpc(ipcMain, runtime, { isTrusted, notifications, ready }) {
  const handle = (name, fn) => ipcMain.handle(`tasks:${name}`, (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Task access requires the trusted app frame.');
    return fn(event, ...args);
  });
  handle('start', (event, input) => runtime.start(input, event.sender.id));
  for (const name of ['queue', 'removeQueued', 'interrupt', 'stop', 'snapshot', 'ack', 'markRead', 'setVisibleTargets']) {
    handle(name, (_event, input) => runtime[name](input));
  }
  handle('forgetTarget', async (_event, target) => {
    await runtime.forgetTarget(target);
    notifications.forgetTarget(target);
  });
  handle('detach', (_event, ids) => {
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((id) => typeof id === 'string')) throw new Error('Invalid tasks.');
    return runtime.detach(ids);
  });
  handle('preferences', (_event, prefs) => {
    if (!prefs || typeof prefs.desktopTaskNotifications !== 'boolean') throw new Error('Invalid notification preferences.');
    notifications.setPreferences(prefs);
  });
  handle('ready', (event) => ready(event.sender));
}

module.exports = { registerTaskIpc };
