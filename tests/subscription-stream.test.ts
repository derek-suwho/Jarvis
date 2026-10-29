import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registerSubscriptionStream } = require('../electron/subscription-stream.cjs');

function fixture() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: vi.fn() });
  const attempts: { emit: (event: unknown) => void; resolve: (result: unknown) => void; stop: ReturnType<typeof vi.fn> }[] = [];
  const adapter = { openAttempt: vi.fn((_input, emit) => {
    let resolve!: (result: unknown) => void;
    const settled = new Promise((done) => { resolve = done; });
    const stop = vi.fn(() => resolve({ kind: 'cancelled' }));
    attempts.push({ emit, resolve, stop });
    return { settled, stop };
  }) };
  registerSubscriptionStream({ handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) }, 'gemini', adapter, (event: any) => event.trusted);
  const event = { sender, trusted: true };
  return { handlers, sender, attempts, adapter, event };
}

describe('subscription stream ownership', () => {
  it('routes deltas and completion only to the initiating renderer', async () => {
    const f = fixture();
    const input = { model: 'gemini-default', messages: [{ role: 'user', content: 'Hello' }] };
    const done = f.handlers.get('gemini:stream')!(f.event, 'request-1', input);
    expect(f.adapter.openAttempt).toHaveBeenCalledWith({ request: { ...input, conversationId: 'request-1' }, updates: [] }, expect.any(Function));
    f.attempts[0].emit({ type: 'delta', text: 'Hi' });
    f.attempts[0].resolve({ kind: 'complete' });
    await done;
    expect(f.sender.send.mock.calls).toEqual([
      ['gemini:stream-event', 'request-1', { type: 'delta', text: 'Hi' }],
      ['gemini:stream-event', 'request-1', { type: 'done' }],
    ]);
    f.attempts[0].emit({ type: 'delta', text: 'Late' });
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    expect(f.sender.listenerCount('destroyed')).toBe(0);
  });

  it('rejects untrusted requests and duplicate ids', async () => {
    const f = fixture();
    const stream = f.handlers.get('gemini:stream')!;
    await expect(stream({ ...f.event, trusted: false }, 'request-1', {})).rejects.toThrow('Untrusted');
    const done = stream(f.event, 'request-1', {});
    await expect(stream(f.event, 'request-1', {})).rejects.toThrow('already running');
    f.attempts[0].resolve({ kind: 'complete' });
    await done;
  });

  it('scopes abort to the owner and stops when its window closes', async () => {
    const f = fixture();
    const done = f.handlers.get('gemini:stream')!(f.event, 'request-1', {});
    f.handlers.get('gemini:abort')!({ sender: { id: 2 }, trusted: true }, 'request-1');
    expect(f.attempts[0].stop).not.toHaveBeenCalled();
    f.sender.emit('destroyed');
    await done;
    expect(f.attempts[0].stop).toHaveBeenCalledOnce();
  });
});
