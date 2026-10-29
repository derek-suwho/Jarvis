/** Legacy renderer streaming bridge; current desktop chats use the task coordinator. */
function registerSubscriptionStream(ipcMain, provider, adapter, isTrusted) {
  const running = new Map();
  ipcMain.handle(`${provider}:stream`, async (event, requestId, request) => {
    if (!isTrusted(event)) throw new Error('Untrusted provider request.');
    if (typeof requestId !== 'string' || !/^[\w:-]{1,120}$/.test(requestId)) throw new Error('Invalid request ID.');
    const owner = event.sender;
    const key = `${owner.id}:${requestId}`;
    if (running.has(key)) throw new Error('This request is already running.');
    if ([...running.values()].filter((entry) => entry.owner === owner).length >= 3) throw new Error('Wait for a response to finish.');
    const entry = { owner, handle: null };
    running.set(key, entry);
    const send = (message) => {
      if (running.get(key) === entry && !owner.isDestroyed()) owner.send(`${provider}:stream-event`, requestId, message);
    };
    const stop = () => entry.handle?.stop();
    owner.once('destroyed', stop);
    try {
      entry.handle = adapter.openAttempt({ request: { ...request, conversationId: request?.conversationId ?? requestId }, updates: [] }, send);
      const result = await entry.handle.settled;
      send(result.kind === 'failed' ? { type: 'error', message: result.error || 'The provider request failed.' } : { type: 'done' });
    } finally {
      owner.removeListener('destroyed', stop);
      running.delete(key);
    }
  });
  ipcMain.handle(`${provider}:abort`, (event, requestId) => {
    if (!isTrusted(event)) throw new Error('Untrusted provider request.');
    running.get(`${event.sender.id}:${requestId}`)?.handle?.stop();
  });
}

module.exports = { registerSubscriptionStream };
