import { afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setState: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: () => [false, lifecycle.setState],
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));
import { SubscriptionConnection } from '../src/components/SubscriptionAccount';
import type { SubscriptionAccount } from '../src/lib/useSubscriptionAccount';

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.clearAllMocks();
});

it.each([false, true])('settles sign-out without updating a closed account panel (unmounted=%s)', async (unmounted) => {
  let complete!: (result: boolean) => void;
  const signOut = vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; }));
  const account = {
    state: { phase: 'connected', name: null, email: null, plan: null }, signOut,
  } as unknown as SubscriptionAccount;
  const view = SubscriptionConnection({ account, onInstall: vi.fn() });
  const cleanups = lifecycle.effects.map((effect) => effect());
  const button = view.props.children[1];
  const pending = button.props.onClick();
  expect(signOut).toHaveBeenCalledOnce();
  expect(lifecycle.setState).toHaveBeenLastCalledWith(true);
  if (unmounted) cleanups.forEach((cleanup) => cleanup?.());
  lifecycle.setState.mockClear();
  complete(false);
  await pending;
  if (unmounted) expect(lifecycle.setState).not.toHaveBeenCalled();
  else {
    expect(lifecycle.setState).toHaveBeenCalledExactlyOnceWith(false);
    cleanups.forEach((cleanup) => cleanup?.());
  }
});
