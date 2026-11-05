import { afterEach, expect, it, vi } from 'vitest';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';

const hooks = vi.hoisted(() => ({ pending: false }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [hooks.pending, (value: boolean) => { hooks.pending = value; }],
  useRef: () => ({ current: true }),
  useEffect: vi.fn(),
}));
import { ChatGPTConnection } from '../src/components/ChatGPTAccount';
afterEach(() => { hooks.pending = false; });

it('disables ChatGPT sign-out until the request settles and permits retry', async () => {
  let finish!: () => void;
  const signOut = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const account = { state: { phase: 'connected', email: null }, signOut } as unknown as ChatGPTAccount;
  const button = () => {
    const action = (ChatGPTConnection({ account }) as any).props.children[1];
    return typeof action.type === 'function' ? action.type(action.props) : action;
  };
  const pending = button().props.onClick();
  expect(button().props.disabled, 'pending sign-out prevents another activation').toBe(true);
  expect(button().props.children).toBe('Signing out…');
  expect(signOut).toHaveBeenCalledOnce();
  finish();
  await pending;
  expect(button().props.disabled).toBe(false);
  expect(button().props.children).toBe('Sign out');
});
