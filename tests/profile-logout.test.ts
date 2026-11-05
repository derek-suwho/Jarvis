import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ index: 0, helpOpen: false, logoutOpen: true, effects: [] as Array<() => void>, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => {
    const setter = vi.fn();
    state.setters.push(setter);
    return [[true, state.helpOpen, state.logoutOpen, false, '', { top: 0, left: 0 }][state.index++], setter];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
  useLayoutEffect: (effect: () => void) => state.effects.push(effect),
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
import { NavigationRail } from '../src/components/NavigationRail';

afterEach(() => { state.index = 0; state.helpOpen = false; state.logoutOpen = true; state.setters.length = 0; state.effects.length = 0; vi.unstubAllGlobals(); });

function logoutButtons(node: ReactElement<any>): ReactElement<any>[] {
  if (node.type === 'button' && node.props.onClick?.constructor.name === 'AsyncFunction') return [node];
  return [node.props.children].flat(Infinity).flatMap((child) =>
    child && typeof child === 'object' && 'props' in child ? logoutButtons(child) : []);
}

it('serializes profile logout requests before rerender and permits retry after a failure', async () => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {});
  let reject!: (error: Error) => void;
  const first = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }))
    .mockResolvedValue(undefined);
  const second = vi.fn().mockResolvedValue(undefined);
  const view = NavigationRail({
    userName: 'Account', subscriptionCount: 2, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(),
    logoutAccounts: [{ id: 'a', label: 'First', logout: first }, { id: 'b', label: 'Second', logout: second }],
  });
  const buttons = logoutButtons(view);
  expect(buttons).toHaveLength(2);
  const pending = buttons[0].props.onClick();
  await buttons[0].props.onClick();
  await buttons[1].props.onClick();
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  reject(new Error('unavailable'));
  await pending;
  await buttons[0].props.onClick();
  expect(first).toHaveBeenCalledTimes(2);
});

function findMenu(node: ReactElement<any>): ReactElement<any> | undefined {
  if (node.props.id === 'profile-menu') return node;
  return [node.props.children].flat(Infinity).map((child) =>
    child && typeof child === 'object' && 'props' in child ? findMenu(child) : undefined).find(Boolean);
}

it.each(['success', 'failure'])('does not reclaim a dismissed profile menu after logout %s', async (outcome) => {
  vi.stubGlobal('document', { body: {}, activeElement: null });
  vi.stubGlobal('window', {});
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const logout = vi.fn(() => new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; }));
  const view = NavigationRail({
    userName: 'Account', subscriptionCount: 1, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(), logoutAccounts: [{ id: 'a', label: 'First', logout }],
  });
  const pending = logoutButtons(view)[0].props.onClick();
  const menu = findMenu(view)!;
  menu.props.onKeyDown({ key: 'Tab', nativeEvent: {}, currentTarget: { querySelectorAll: () => [] } });
  const callsAfterDismissal = state.setters.map((setter) => setter.mock.calls.length);
  if (outcome === 'success') complete();
  else fail(new Error('unavailable'));
  await pending;
  // Completion may clear pending state, but cannot close a newer menu, move
  // focus back to its trigger, or inject an error into a dismissed interaction.
  for (const index of [0, 1, 2, 4]) {
    expect(state.setters[index].mock.calls.length).toBe(callsAfterDismissal[index]);
  }
  expect(state.setters[3]).toHaveBeenLastCalledWith(false);
});

it.each([
  { key: 'ArrowDown', isComposing: true },
  { key: 'Escape', isComposing: true },
  { key: 'ArrowDown', keyCode: 229 },
])('leaves composing profile-menu keys to the input method: %j', (input) => {
  vi.stubGlobal('document', { body: {}, activeElement: null });
  vi.stubGlobal('window', {});
  const view = NavigationRail({
    userName: 'Account', subscriptionCount: 0, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(), logoutAccounts: [],
  });
  const focus = vi.fn();
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  findMenu(view)!.props.onKeyDown({
    ...input, nativeEvent: input, currentTarget: { querySelectorAll: () => [{ focus }] },
    preventDefault, stopPropagation,
  });
  expect(focus).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(stopPropagation).not.toHaveBeenCalled();
  expect(state.setters[0]).not.toHaveBeenCalled();
});


it.each(['help', 'logout'] as const)('closes only the %s submenu on Escape and restores its parent item', (submenu) => {
  vi.stubGlobal('document', { body: {}, activeElement: null });
  vi.stubGlobal('window', {});
  state.helpOpen = submenu === 'help';
  state.logoutOpen = submenu === 'logout';
  const props = {
    userName: 'Account', subscriptionCount: 1, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(),
    logoutAccounts: [{ id: 'a', label: 'First', logout: vi.fn().mockResolvedValue(undefined) }],
  };
  const menu = findMenu(NavigationRail(props))!;
  const focus = vi.fn();
  const querySelector = vi.fn(() => ({ focus }));
  (menu as any).ref.current = { querySelector };
  const event = () => ({ key: 'Escape', nativeEvent: {},
    currentTarget: { querySelectorAll: () => [] }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const escape = event();
  menu.props.onKeyDown(escape);
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.setters[submenu === 'help' ? 1 : 2]).toHaveBeenCalledExactlyOnceWith(false);
  expect(querySelector).toHaveBeenCalledExactlyOnceWith(`[data-${submenu}]`);
  expect(focus).toHaveBeenCalledOnce();
  expect(escape.preventDefault).toHaveBeenCalledOnce();
  expect(escape.stopPropagation).toHaveBeenCalledOnce();
  // After the submenu closes, a fresh Escape dismisses the profile menu.
  state.helpOpen = false;
  state.logoutOpen = false;
  state.index = 0;
  state.setters.length = 0;
  findMenu(NavigationRail(props))!.props.onKeyDown(event());
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
});

it.each(['ArrowDown', 'ArrowUp', 'Home', 'End'])('keeps %s navigation inside the active profile submenu', (key) => {
  vi.stubGlobal('window', {});
  const root = {};
  const submenu = {};
  const parentItem = { focus: vi.fn(), closest: () => root };
  const first = { focus: vi.fn(), closest: () => submenu };
  const last = { focus: vi.fn(), closest: () => submenu };
  const active = key === 'ArrowDown' ? last : first;
  vi.stubGlobal('document', { body: {}, activeElement: active });
  const menu = findMenu(NavigationRail({
    userName: 'Account', subscriptionCount: 2, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(), logoutAccounts: [
      { id: 'a', label: 'First', logout: vi.fn() }, { id: 'b', label: 'Second', logout: vi.fn() },
    ],
  }))!;
  const preventDefault = vi.fn();
  menu.props.onKeyDown({ key, nativeEvent: {},
    currentTarget: { querySelectorAll: () => [parentItem, first, last] },
    preventDefault, stopPropagation: vi.fn(),
  });
  expect(parentItem.focus).not.toHaveBeenCalled();
  expect((key === 'ArrowDown' || key === 'Home' ? first : last).focus).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
});

it('preserves IME composition on the profile trigger and opens on a fresh arrow key', () => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {});
  const view = NavigationRail({
    userName: 'Account', subscriptionCount: 0, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(), logoutAccounts: [],
  });
  const findTrigger = (node: ReactElement<any>): ReactElement<any> | undefined => {
    if (node.props['aria-label'] === 'Profile menu') return node;
    return [node.props.children].flat(Infinity).map((child) =>
      child && typeof child === 'object' && 'props' in child ? findTrigger(child) : undefined).find(Boolean);
  };
  const trigger = findTrigger(view)!;
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
      const preventDefault = vi.fn();
      trigger.props.onKeyDown({ key, nativeEvent, preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(state.setters[0]).not.toHaveBeenCalled();
    }
  }
  const preventDefault = vi.fn();
  trigger.props.onKeyDown({ key: 'ArrowDown', nativeEvent: {}, preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(true);
});


it.each(['ArrowUp', 'ArrowDown', 'default'])('enters the profile menu at the expected endpoint for %s', (key) => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {});
  const view = NavigationRail({
    userName: 'Account', subscriptionCount: 1, homeActive: true, historyOpen: false,
    scheduledActive: false, onHome: vi.fn(), onToggleHistory: vi.fn(), onScheduled: vi.fn(),
    onSettings: vi.fn(), onHelp: vi.fn(),
    logoutAccounts: [{ id: 'a', label: 'First', logout: vi.fn() }],
  });
  const findTrigger = (node: ReactElement<any>): ReactElement<any> | undefined => {
    if (node.props['aria-label'] === 'Profile menu') return node;
    return [node.props.children].flat(Infinity).map((child) =>
      child && typeof child === 'object' && 'props' in child ? findTrigger(child) : undefined).find(Boolean);
  };
  const trigger = findTrigger(view)!;
  const first = { focus: vi.fn() };
  const last = { focus: vi.fn() };
  (findMenu(view)! as any).ref.current = {
    querySelector: () => first, querySelectorAll: () => [first, last],
  };
  if (key !== 'default') trigger.props.onKeyDown({ key, nativeEvent: {}, preventDefault: vi.fn() });
  // Run the opening focus effect after the keyboard request and menu mount.
  state.effects[1]();
  expect((key === 'ArrowUp' ? last : first).focus).toHaveBeenCalledOnce();
  expect((key === 'ArrowUp' ? first : last).focus).not.toHaveBeenCalled();
});
