import type {
  ProviderEvent,
  ProviderRequest,
  SubscriptionAdapter,
} from './types';

export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Operation aborted');
}
/** Race every next() against abort, including adapters that ignore the signal. Never await hostile return(). */
export async function* abortableStream(
  adapter: SubscriptionAdapter,
  request: ProviderRequest,
  signal: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  if (signal.aborted) throw abortError(signal);
  const iterator = adapter.stream(request, signal)[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      let abort: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(abortError(signal));
        signal.addEventListener('abort', abort, { once: true });
      });
      let step: IteratorResult<ProviderEvent>;
      try {
        step = await Promise.race([
          Promise.resolve().then(() => iterator.next()),
          cancelled,
        ]);
      } finally {
        signal.removeEventListener('abort', abort);
      }
      if (signal.aborted) throw abortError(signal);
      if (step.done) {
        completed = true;
        return;
      }
      yield step.value;
    }
  } finally {
    if (!completed && iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        /* Cleanup cannot block cancellation. */
      }
    }
  }
}
