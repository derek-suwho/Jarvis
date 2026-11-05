import { afterEach, expect, it, vi } from 'vitest';
import type { SubscriptionAccount } from '../src/lib/useSubscriptionAccount';

const state = vi.hoisted(() => ({ values: [false, false], index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => {
    const index = state.index++;
    return [state.values[index], (value: boolean) => { state.values[index] = value; }];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
}));
import { SubscriptionConnection } from '../src/components/SubscriptionAccount';
afterEach(() => { state.values = [false, false]; state.index = 0; });

it('requires a fresh keyboard activation to confirm shared-provider sign-out', async () => {
  const signOut = vi.fn().mockResolvedValue(true);
  const account = { state: { phase: 'connected' }, signOut } as unknown as SubscriptionAccount;
  const button = () => {
    state.index = 0;
    return SubscriptionConnection({ account, onInstall: vi.fn(), signOutNotice: 'Also signs out the provider app' }).props.children[1];
  };
  await button().props.onClick();
  expect(button().props.children).toBe('Confirm sign out');
  for (const properties of [
    { key: 'Enter', repeat: true },
    { key: ' ', repeat: true },
    { key: 'Enter', nativeEvent: { isComposing: true } },
    { key: 'Enter', keyCode: 229 },
  ]) {
    const event = { nativeEvent: {}, preventDefault: vi.fn(), ...properties };
    const target = button();
    target.props.onKeyDown?.(event);
    if (!event.preventDefault.mock.calls.length) await target.props.onClick();
    expect(signOut).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(button().props.children).toBe('Confirm sign out');
  }
  const event = { key: 'Enter', repeat: false, nativeEvent: {}, preventDefault: vi.fn() };
  const target = button();
  target.props.onKeyDown?.(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  await target.props.onClick();
  expect(signOut).toHaveBeenCalledOnce();
  expect(state.values[1]).toBe(false);
});

it('Escape cancels shared-provider sign-out confirmation and requires a fresh confirmation', async () => {
  const signOut = vi.fn().mockResolvedValue(true);
  const account = { state: { phase: 'connected' }, signOut } as unknown as SubscriptionAccount;
  const button = () => {
    state.index = 0;
    return SubscriptionConnection({ account, onInstall: vi.fn(), signOutNotice: 'Also signs out the provider app' }).props.children[1];
  };
  await button().props.onClick();
  expect(button().props.children).toBe('Confirm sign out');
  const event = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button().props.onKeyDown(event);
  expect(button().props.children).toBe('Sign out');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(signOut).not.toHaveBeenCalled();
  await button().props.onClick();
  expect(button().props.children).toBe('Confirm sign out');
  expect(signOut).not.toHaveBeenCalled();
  await button().props.onClick();
  expect(signOut).toHaveBeenCalledOnce();
});
