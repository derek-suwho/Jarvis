import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const state = vi.hoisted(() => ({ armed: false, signingOut: false, cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => unknown) => { effect(); },
  useState: () => {
    const key = state.cursor++ === 0 ? 'armed' : 'signingOut';
    return [state[key], (value: boolean) => { state[key] = value; }];
  },
}));
import { ClaudeConnection } from '../src/components/ClaudeAccount';
import type { ClaudeAccount } from '../src/lib/useClaude';

afterEach(() => { state.armed = false; state.signingOut = false; state.cursor = 0; });

it('requires a fresh keyboard activation to confirm signing out Claude Code in Terminal', () => {
  const signOut = vi.fn();
  const account = { state: { phase: 'connected' }, signOut } as unknown as ClaudeAccount;
  const button = () => {
    state.cursor = 0;
    const child = ClaudeConnection({ account }) as ReactElement;
    return (child.type as (props: unknown) => ReactElement)(child.props).props.children[1];
  };
  button().props.onClick();
  expect(state.armed).toBe(true);
  for (const properties of [
    { key: 'Enter', repeat: true },
    { key: ' ', repeat: true },
    { key: 'Enter', nativeEvent: { isComposing: true } },
    { key: 'Enter', keyCode: 229 },
  ]) {
    const event = { nativeEvent: {}, preventDefault: vi.fn(), ...properties };
    const target = button();
    target.props.onKeyDown?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    if (!event.preventDefault.mock.calls.length) target.props.onClick();
    expect(signOut).not.toHaveBeenCalled();
    expect(state.armed).toBe(true);
  }
  const event = { key: 'Enter', repeat: false, nativeEvent: {}, preventDefault: vi.fn() };
  const target = button();
  target.props.onKeyDown?.(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  target.props.onClick();
  expect(signOut).toHaveBeenCalledOnce();
  expect(state.armed).toBe(false);
});

it('Escape cancels Claude sign-out confirmation without closing the account panel', async () => {
  const signOut = vi.fn().mockResolvedValue(true);
  const account = { state: { phase: 'connected' }, signOut } as unknown as ClaudeAccount;
  const button = () => {
    state.cursor = 0;
    const child = ClaudeConnection({ account }) as ReactElement;
    return (child.type as (props: unknown) => ReactElement)(child.props).props.children[1];
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
