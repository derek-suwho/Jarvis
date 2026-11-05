import { afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setCopied: vi.fn(),
  setError: vi.fn(),
}));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
  useState: (value: unknown) => [value, typeof value === 'string' ? lifecycle.setError : lifecycle.setCopied],
}));
import { useCopy } from '../src/components/useCopy';

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])('handles clipboard completion with unmounted=%s', async (unmounted) => {
  let complete!: () => void;
  const writeText = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  const setTimeout = vi.fn(() => 42);
  const clearTimeout = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  copy('response text');
  expect(writeText).toHaveBeenCalledWith('response text');
  expect(lifecycle.setCopied).not.toHaveBeenCalledWith(true);
  if (unmounted && cleanup) cleanup();
  complete();
  await Promise.resolve();
  if (unmounted) {
    expect(lifecycle.setCopied).not.toHaveBeenCalledWith(true);
    expect(setTimeout).not.toHaveBeenCalled();
  } else {
    expect(lifecycle.setCopied).toHaveBeenCalledWith(true);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
    (setTimeout.mock.calls[0] as unknown as [() => void])[0]();
    expect(lifecycle.setCopied).toHaveBeenLastCalledWith(false);
    if (cleanup) cleanup();
    expect(clearTimeout).toHaveBeenLastCalledWith(42);
  }
});

it('keeps the copy action usable when the clipboard API throws synchronously', async () => {
  const writeText = vi.fn()
    .mockImplementationOnce(() => { throw new Error('Clipboard unavailable'); })
    .mockResolvedValueOnce(undefined);
  const setTimeout = vi.fn(() => 42);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('window', { setTimeout, clearTimeout: vi.fn() });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  try {
    expect(() => copy('first response')).not.toThrow();
    expect(lifecycle.setCopied).not.toHaveBeenCalledWith(true);
    expect(setTimeout).not.toHaveBeenCalled();
    copy('second response');
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith('second response');
    expect(lifecycle.setCopied).toHaveBeenCalledWith(true);
    expect(setTimeout).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
});

it('keeps feedback on the latest copy when an older clipboard request completes after a failure', async () => {
  let complete!: () => void;
  const writeText = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }))
    .mockRejectedValueOnce(new Error('Clipboard denied'));
  const setTimeout = vi.fn(() => 42);
  const clearTimeout = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  try {
    await copy('initial success');
    expect(lifecycle.setCopied).toHaveBeenLastCalledWith(true);
    copy('slow request');
    await copy('latest denied request');
    complete();
    await Promise.resolve();
    expect(lifecycle.setCopied).toHaveBeenLastCalledWith(false);
    expect(setTimeout).toHaveBeenCalledOnce();
    expect(clearTimeout).toHaveBeenCalledWith(42);
  } finally {
    if (cleanup) cleanup();
  }
});

it.each(['denied', 'unavailable'])('reports a safe clipboard %s failure and clears it on retry', async (outcome) => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('private clipboard details')).mockResolvedValueOnce(undefined);
  vi.stubGlobal('navigator', outcome === 'unavailable' ? {} : { clipboard: { writeText } });
  vi.stubGlobal('window', { setTimeout: vi.fn(() => 42), clearTimeout: vi.fn() });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  await copy('response');
  expect(lifecycle.setError).toHaveBeenLastCalledWith('Could not copy. Try again or select the text to copy manually.');
  expect(lifecycle.setCopied).not.toHaveBeenCalledWith(true);
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  await copy('response');
  expect(lifecycle.setError).toHaveBeenLastCalledWith('');
  expect(lifecycle.setCopied).toHaveBeenLastCalledWith(true);
  if (cleanup) cleanup();
});

it('does not overwrite the clipboard through a retained copy callback after its view closes', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clearTimeout = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('window', { setTimeout: vi.fn(() => 42), clearTimeout });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  await copy('visible response');
  expect(writeText).toHaveBeenCalledExactlyOnceWith('visible response');
  if (cleanup) cleanup();
  vi.clearAllMocks();
  await copy('closed response');
  expect(writeText).not.toHaveBeenCalled();
  expect(lifecycle.setCopied).not.toHaveBeenCalled();
  expect(lifecycle.setError).not.toHaveBeenCalled();
  expect(clearTimeout).not.toHaveBeenCalled();
});

it('preserves a newer copy success when a previously queued feedback timer runs', async () => {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('window', {
    setTimeout: vi.fn((callback: () => void) => { callbacks.push(callback); return callbacks.length; }),
    clearTimeout: vi.fn(),
  });
  const [, copy] = useCopy();
  const cleanup = lifecycle.effects[0]();
  try {
    await copy('first response');
    await copy('second response');
    lifecycle.setCopied.mockClear();
    // clearTimeout cannot retract a callback that has already entered the task queue.
    callbacks[0]();
    expect(lifecycle.setCopied).not.toHaveBeenCalled();
    callbacks[1]();
    expect(lifecycle.setCopied).toHaveBeenCalledExactlyOnceWith(false);
    lifecycle.setCopied.mockClear();
    if (cleanup) cleanup();
    callbacks[1]();
    expect(lifecycle.setCopied).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});
