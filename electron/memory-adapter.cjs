const { randomUUID } = require('node:crypto');

/** Private main-process bridge. Extraction has no tools or interactive task continuation. */
function createMemoryAdapter(id, openAttempt) {
  return {
    id,
    async *stream({ model, context }, signal) {
      if (signal.aborted) throw new Error('Extraction aborted');
      let handle;
      let output = '';
      let bytes = 0;
      let failure;
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const abort = () => {
        rejectCancelled(new Error('Extraction aborted'));
        handle?.stop();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        handle = openAttempt({ provider: id, toolsDisabled: true, updates: [],
          request: { model: model.modelId, mode: 'chat', conversationId: randomUUID(),
            messages: [{ role: 'user', content: context.instructions }, ...context.messages] } }, event => {
          if (signal.aborted || failure) return;
          if (event.type === 'delta' && typeof event.text === 'string') {
            bytes += Buffer.byteLength(event.text);
            if (bytes > 24 * 1024) {
              failure = new Error('Extraction output exceeds byte limit');
              rejectCancelled(failure);
              handle?.stop();
            } else output += event.text;
          } else if (event.type === 'tool') {
            failure = new Error('Extraction attempted a tool');
            rejectCancelled(failure);
            handle?.stop();
          }
        });
        // Opening may synchronously cancel before the handle is assigned.
        if (failure || signal.aborted) handle.stop();
        const outcome = await Promise.race([handle.settled, cancelled]);
        if (signal.aborted) throw new Error('Extraction aborted');
        if (failure) throw failure;
        if (outcome.kind !== 'complete' || outcome.uncertainEffects) throw new Error('Extraction provider did not complete');
        yield { type: 'delta', text: output };
        yield { type: 'done' };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  };
}
module.exports = { createMemoryAdapter };
