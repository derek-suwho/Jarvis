import { afterEach, expect, it, vi } from 'vitest';
import type { ClaudeAccount } from '../src/lib/useClaude';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => unknown) => { effect(); },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
import { ClaudeConnection } from '../src/components/ClaudeAccount';

afterEach(() => { hooks.values = []; hooks.cursor = 0; });

it('disables Claude sign-out while pending and restores confirmation after a failed attempt', async () => {
  let finish!: (value: boolean) => void;
  const signOut = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const account = { state: { phase: 'connected' }, signOut } as unknown as ClaudeAccount;
  const button = () => {
    hooks.cursor = 0;
    const child = ClaudeConnection({ account }) as any;
    return child.type(child.props).props.children[1];
  };
  button().props.onClick();
  expect(button().props.children).toBe('Confirm sign out');
  const pending = button().props.onClick();
  expect(button().props.disabled, 'pending sign-out prevents another activation').toBe(true);
  expect(button().props.children).toBe('Signing out…');
  expect(signOut).toHaveBeenCalledOnce();
  finish(false);
  await pending;
  expect(button().props.disabled).toBe(false);
  expect(button().props.children).toBe('Sign out');
  button().props.onClick();
  expect(button().props.children).toBe('Confirm sign out');
  expect(signOut).toHaveBeenCalledOnce();
});
