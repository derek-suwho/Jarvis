import { afterEach, expect, it, vi } from 'vitest';
import type { ClaudeAccount } from '../src/lib/useClaude';

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cursor: 0,
  setPending: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: () => lifecycle.cursor++ === 0 ? [true, vi.fn()] : [false, lifecycle.setPending],
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));
import { ClaudeConnection } from '../src/components/ClaudeAccount';

afterEach(() => {
  lifecycle.effects.length = 0;
  lifecycle.cursor = 0;
  vi.clearAllMocks();
});

it.each([false, true])('settles Claude sign-out safely when the account panel is closed (unmounted=%s)', async (unmounted) => {
  let complete!: (result: boolean) => void;
  const signOut = vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; }));
  const account = { state: { phase: 'connected' }, signOut } as unknown as ClaudeAccount;
  const child = ClaudeConnection({ account }) as any;
  const view = child.type(child.props);
  const cleanups = lifecycle.effects.map((effect) => effect());
  const pending = view.props.children[1].props.onClick();
  expect(signOut).toHaveBeenCalledOnce();
  expect(lifecycle.setPending).toHaveBeenLastCalledWith(true);
  if (unmounted) cleanups.forEach((cleanup) => cleanup?.());
  lifecycle.setPending.mockClear();
  complete(false);
  await pending;
  if (unmounted) expect(lifecycle.setPending).not.toHaveBeenCalled();
  else {
    expect(lifecycle.setPending).toHaveBeenCalledExactlyOnceWith(false);
    cleanups.forEach((cleanup) => cleanup?.());
  }
});
