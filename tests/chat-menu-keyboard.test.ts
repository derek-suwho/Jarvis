import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[], layouts: [] as (() => void)[], open: true, moveOpen: false, error: '', setError: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    if (typeof initial === 'string') return [state.error, state.setError];
    const setter = vi.fn();
    state.setters.push(setter);
    return [state.setters.length % 3 === 1 ? state.open : state.setters.length % 3 === 2 ? state.moveOpen : initial, setter];
  },
  useId: () => 'chat-action-error',
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn((effect: () => void) => { state.layouts.push(effect); }),
}));
vi.mock('react-dom', () => ({ createPortal: (child: unknown) => child }));
import { ChatMenu } from '../src/components/ChatMenu';
import { useEffect, useLayoutEffect } from 'react';

beforeEach(() => {
  vi.mocked(useEffect).mockClear();
  vi.mocked(useLayoutEffect).mockClear();
});

afterEach(() => {
  state.open = true;
  state.moveOpen = false;
  state.error = '';
  state.setError.mockReset();
  state.setters.length = 0;
  state.layouts.length = 0;
  vi.unstubAllGlobals();
});

it('dismisses chat options on focus departure without stealing destination focus', () => {
  vi.stubGlobal('document', { body: {} });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  const triggerNode = { focus, contains: (node: unknown) => node === triggerNode };
  const menuItem = {};
  trigger.ref.current = triggerNode;
  menu.ref.current = { contains: (node: unknown) => node === menuItem };
  for (const relatedTarget of [menuItem, triggerNode]) {
    menu.props.onBlur?.({ relatedTarget });
    expect(state.setters[0]).not.toHaveBeenCalled();
  }
  for (const relatedTarget of [{}, null]) {
    menu.props.onBlur?.({ relatedTarget });
    expect(state.setters[0]).toHaveBeenLastCalledWith(false);
    expect(state.setters[1]).toHaveBeenLastCalledWith(false);
  }
  expect(focus).not.toHaveBeenCalled();
});

it('preserves composing and handled chat-menu keys while ordinary Escape dismisses', () => {
  const items = [{ focus: vi.fn() }, { focus: vi.fn() }];
  vi.stubGlobal('document', { body: {}, activeElement: items[0] });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  trigger.ref.current = { focus };
  for (const properties of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft', 'Escape', 'Tab']) {
      const event = {
        key, nativeEvent: properties, ...properties,
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
        currentTarget: { querySelectorAll: () => items },
        target: { closest: () => true },
      };
      trigger.props.onKeyDown(event);
      menu.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  }
  for (const setter of state.setters) expect(setter).not.toHaveBeenCalled();
  for (const item of items) expect(item.focus).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  const event = {
    key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { querySelectorAll: () => items },
  };
  menu.props.onKeyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  expect(focus).toHaveBeenCalledOnce();
});

it('opens chat options at the last action for Arrow Up and first for Arrow Down', () => {
  vi.stubGlobal('document', { body: {} });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const items = [{ focus: vi.fn() }, { focus: vi.fn() }];
  menu.ref.current = { querySelector: () => items[0], querySelectorAll: () => items };
  for (const [key, index] of [['ArrowUp', 1], ['ArrowDown', 0]] as const) {
    items.forEach(item => item.focus.mockClear());
    const event = { key, nativeEvent: {}, preventDefault: vi.fn() };
    trigger.props.onKeyDown(event);
    state.layouts[1]();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(items[index].focus).toHaveBeenCalledOnce();
    expect(items[1 - index].focus).not.toHaveBeenCalled();
  }
});

it('navigates chat actions by initial letter, wrapping matches without consuming shortcuts', () => {
  const items = ['Rename', 'Pin chat', 'Move to project', 'Export as Markdown', 'Archive chat', 'Delete chat']
    .map(textContent => ({ textContent, focus: vi.fn() }));
  const documentStub = { body: {}, activeElement: items[0] };
  vi.stubGlobal('document', documentStub);
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const menu = view.props.children[1];
  const send = (key: string, extra = {}) => {
    const event = { key, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { querySelectorAll: () => items }, ...extra };
    menu.props.onKeyDown(event);
    return event;
  };
  expect(send('a').preventDefault).toHaveBeenCalledOnce();
  expect(items[4].focus).toHaveBeenCalledOnce();
  documentStub.activeElement = items[5];
  send('R');
  expect(items[0].focus).toHaveBeenCalledOnce();
  items.forEach(item => item.focus.mockClear());
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { nativeEvent: { isComposing: true } }]) {
    expect(send('a', extra).preventDefault).not.toHaveBeenCalled();
  }
  expect(send('z').preventDefault).not.toHaveBeenCalled();
  expect(send(' ').preventDefault).not.toHaveBeenCalled();
  items.forEach(item => expect(item.focus).not.toHaveBeenCalled());
  items[2].textContent = 'Review';
  documentStub.activeElement = items[0];
  send('r');
  expect(items[2].focus).toHaveBeenCalledOnce();
  documentStub.activeElement = items[2];
  send('r');
  expect(items[0].focus).toHaveBeenCalledOnce();
});


it('dismisses stale chat actions when the selected conversation changes without stealing focus', () => {
  vi.stubGlobal('document', { body: {} });
  const props = {
    chat: { id: 'first', title: 'First chat' } as any, projects: [], variant: 'topbar' as const,
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  };
  const view = ChatMenu(props);
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  // Run only effects whose dependencies change with conversation identity.
  const firstEffects = vi.mocked(useEffect).mock.calls.slice();
  vi.mocked(useEffect).mockClear();
  ChatMenu({ ...props, chat: { ...props.chat, id: 'second', title: 'Second chat' } });
  const changedEffects = vi.mocked(useEffect).mock.calls.filter(([, deps], index) =>
    deps?.some((dep, depIndex) => dep !== firstEffects[index]?.[1]?.[depIndex]));
  expect(changedEffects).toHaveLength(1);
  changedEffects[0][0]();
  expect(state.setters[3]).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.setters[4]).toHaveBeenCalledExactlyOnceWith(false);
  expect(focus).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();
});

it('re-enters already expanded project options with Arrow Right', () => {
  state.moveOpen = true;
  const toggle = { focus: vi.fn() };
  const project = { focus: vi.fn() };
  vi.stubGlobal('document', { body: {}, activeElement: toggle });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any,
    projects: [{ id: 'project', name: 'Project' }] as any,
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const menu = view.props.children[1];
  menu.ref.current = { querySelector: () => project };
  const event = {
    key: 'ArrowRight', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { querySelectorAll: () => [toggle, project] },
    target: { closest: () => toggle },
  };
  // The section is already expanded, so setting moveOpen=true cannot rerun its layout effect.
  menu.props.onKeyDown(event);
  expect(project.focus).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(toggle.focus).not.toHaveBeenCalled();
});

it('collapses expanded project options with Escape before dismissing chat options', () => {
  state.moveOpen = true;
  const toggle = { focus: vi.fn() };
  const project = { focus: vi.fn() };
  vi.stubGlobal('document', { body: {}, activeElement: project });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any,
    projects: [{ id: 'project', name: 'Project' }] as any,
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const triggerFocus = vi.fn();
  trigger.ref.current = { focus: triggerFocus };
  menu.ref.current = { querySelector: () => toggle };
  const event = {
    key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { querySelectorAll: () => [toggle, project] },
  };
  menu.props.onKeyDown(event);
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith(false);
  expect(toggle.focus).toHaveBeenCalledOnce();
  expect(triggerFocus).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
});


it('keeps a failed chat export available with safe feedback and closes after retry', () => {
  vi.stubGlobal('document', { body: {} });
  const onExport = vi.fn().mockImplementationOnce(() => { throw new Error('private storage path'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport, onMove: vi.fn(),
  });
  const menu = render().props.children[1];
  const focus = vi.fn();
  const event = { stopPropagation: vi.fn(), currentTarget: { focus } };
  const exportItem = (menu: any) => menu.props.children.find((child: any) => child?.key === 'Export as Markdown');
  expect(() => exportItem(menu).props.onClick(event)).not.toThrow();
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  const retryMenu = render().props.children[1];
  const alert = retryMenu.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not complete this action. Try again.');
  expect(exportItem(retryMenu).props['aria-describedby']).toBe(alert.props.id);
  exportItem(retryMenu).props.onClick(event);
  expect(onExport).toHaveBeenCalledTimes(2);
  expect(onExport).toHaveBeenLastCalledWith('chat');
  expect(state.setters[3]).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.error).toBe('');
});

it.each([false, true])('requires a fresh Escape press to dismiss chat options with project list open=%s', (expanded) => {
  state.moveOpen = expanded;
  const toggle = { focus: vi.fn() };
  vi.stubGlobal('document', { body: {}, activeElement: toggle });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  trigger.ref.current = { focus };
  menu.ref.current = { querySelector: () => toggle };
  const event = {
    key: 'Escape', repeat: true, nativeEvent: {},
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { querySelectorAll: () => [toggle] },
  };
  menu.props.onKeyDown(event);
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.setters[1]).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(toggle.focus).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  menu.props.onKeyDown({ ...event, repeat: false });
  expect(state.setters[expanded ? 1 : 0]).toHaveBeenCalledExactlyOnceWith(false);
  expect(expanded ? toggle.focus : focus).toHaveBeenCalledOnce();
});

it('dismisses chat options on outside touch without stealing focus and cleans up the listener', () => {
  const listeners = new Map<string, (event: any) => void>();
  const removeEventListener = vi.fn((name: string) => listeners.delete(name));
  vi.stubGlobal('document', {
    body: {},
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener,
  });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  const triggerNode = { focus, contains: (node: unknown) => node === triggerNode };
  const item = {};
  trigger.ref.current = triggerNode;
  menu.ref.current = { contains: (node: unknown) => node === item };
  const effect = vi.mocked(useEffect).mock.calls.at(-1)![0];
  const cleanup = effect();
  try {
    expect(listeners.has('touchstart')).toBe(true);
    for (const target of [item, triggerNode]) listeners.get('touchstart')!({ target });
    expect(state.setters[0]).not.toHaveBeenCalled();
    listeners.get('touchstart')!({ target: {} });
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith(false);
    expect(focus).not.toHaveBeenCalled();
  } finally {
    if (typeof cleanup === 'function') cleanup();
  }
  expect(removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
  expect(listeners.size).toBe(0);
});


it('repositions growing chat options after an action failure to keep feedback within the viewport', () => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {
    innerHeight: 600, innerWidth: 800,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  const props = {
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  };
  const attach = (view: any, height: number) => {
    view.props.children[0].ref.current = {
      getBoundingClientRect: () => ({ top: 270, bottom: 290, right: 780 }),
    };
    view.props.children[1].ref.current = {
      getBoundingClientRect: () => ({ height, width: 240 }),
    };
  };
  const initial = ChatMenu(props);
  attach(initial, 280);
  const previous = vi.mocked(useLayoutEffect).mock.calls.slice();
  const cleanup = previous[0][0]();
  expect(state.setters[2]).toHaveBeenLastCalledWith({ top: 296, left: 540 });
  if (typeof cleanup === 'function') cleanup();

  state.error = 'Could not complete this action. Try again.';
  vi.mocked(useLayoutEffect).mockClear();
  const failed = ChatMenu(props);
  attach(failed, 340);
  vi.mocked(useLayoutEffect).mock.calls.forEach(([effect, deps], index) => {
    if (deps?.some((dep, i) => dep !== previous[index]?.[1]?.[i])) {
      const cleanup = effect();
      if (typeof cleanup === 'function') cleanup();
    }
  });
  expect(state.setters[5]).toHaveBeenLastCalledWith({ top: 8, left: 540 });
});

it('enters chat actions at the appropriate endpoint when no action has focus', () => {
  const items = ['Rename', 'Archive chat', 'Delete chat'].map(textContent => ({ textContent, focus: vi.fn() }));
  vi.stubGlobal('document', { body: {}, activeElement: {} });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const menu = view.props.children[1];
  for (const [key, index] of [['ArrowUp', 2], ['ArrowDown', 0]] as const) {
    items.forEach(item => item.focus.mockClear());
    const event = { key, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { querySelectorAll: () => items } };
    menu.props.onKeyDown(event);
    expect(items[index].focus).toHaveBeenCalledOnce();
    items.forEach((item, i) => { if (i !== index) expect(item.focus).not.toHaveBeenCalled(); });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  }
  expect(state.setters[0]).not.toHaveBeenCalled();
});

it('dismisses chat actions and project options when the app loses focus without invoking an action', () => {
  state.moveOpen = true;
  const listeners = new Map<string, () => void>();
  const removeEventListener = vi.fn((name: string) => listeners.delete(name));
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener,
  });
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const onDelete = vi.fn();
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete, onExport: vi.fn(), onMove: vi.fn(),
  });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  const cleanups = vi.mocked(useEffect).mock.calls.slice(1).map(([effect]) => effect());
  try {
    expect(listeners.has('blur')).toBe(true);
    listeners.get('blur')!();
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setError).toHaveBeenCalledExactlyOnceWith('');
    expect(focus).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  } finally {
    cleanups.forEach(cleanup => { if (typeof cleanup === 'function') cleanup(); });
  }
  expect(removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it.each(['Enter', ' '])('requires a fresh %j press to retry a failed chat action', (key) => {
  vi.stubGlobal('document', { body: {} });
  const onDelete = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete, onExport: vi.fn(), onMove: vi.fn(),
  });
  const menu = view.props.children[1];
  const action = menu.props.children.find((child: any) => child?.key === 'Delete chat');
  const item = { focus: vi.fn() };
  const press = (repeat: boolean) => {
    const event = { key, repeat, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { querySelectorAll: () => [item] } };
    menu.props.onKeyDown(event);
    // Model native button activation from an uncancelled Enter/Space key.
    if (!event.preventDefault.mock.calls.length) action.props.onClick({ stopPropagation: vi.fn(), currentTarget: item });
    return event;
  };
  press(false);
  expect(onDelete).toHaveBeenCalledOnce();
  const held = press(true);
  expect(held.preventDefault).toHaveBeenCalledOnce();
  expect(held.stopPropagation).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
  press(false);
  expect(onDelete).toHaveBeenCalledTimes(2);
});

it('dismisses open chat options when focus leaves the trigger for another control', () => {
  vi.stubGlobal('document', { body: {} });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  const triggerNode = { focus, contains: (node: unknown) => node === triggerNode };
  const menuItem = {};
  trigger.ref.current = triggerNode;
  menu.ref.current = { contains: (node: unknown) => node === menuItem };
  for (const relatedTarget of [menuItem, triggerNode]) {
    trigger.props.onBlur?.({ relatedTarget });
    expect(state.setters[0]).not.toHaveBeenCalled();
  }
  for (const relatedTarget of [{}, null]) {
    state.setters.forEach(setter => setter.mockClear());
    trigger.props.onBlur?.({ relatedTarget });
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith(false);
  }
  expect(focus).not.toHaveBeenCalled();
});

it('preserves chat options when another control consumes outside input', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', { body: {},
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  ChatMenu({ chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn() });
  const cleanup = vi.mocked(useEffect).mock.calls.at(-1)![0]();
  try {
    for (const name of ['mousedown', 'touchstart']) {
      listeners.get(name)!({ target: {}, defaultPrevented: true });
      expect(state.setters[0]).not.toHaveBeenCalled();
    }
    listeners.get('mousedown')!({ target: {}, defaultPrevented: false });
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  } finally { if (typeof cleanup === 'function') cleanup(); }
  expect(listeners.size).toBe(0);
});

it('preserves chat actions for outside context-menu presses while primary clicks still dismiss', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', { body: {},
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const view = ChatMenu({ chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn() });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus, contains: () => false };
  view.props.children[1].ref.current = { contains: () => false };
  const cleanup = vi.mocked(useEffect).mock.calls.at(-1)![0]();
  try {
    for (const button of [2, 1]) {
      listeners.get('mousedown')!({ target: {}, button });
      expect(state.setters[0]).not.toHaveBeenCalled();
      expect(state.setters[1]).not.toHaveBeenCalled();
    }
    listeners.get('mousedown')!({ target: {}, button: 0 });
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith(false);
    expect(focus).not.toHaveBeenCalled();
  } finally { if (typeof cleanup === 'function') cleanup(); }
  expect(listeners.size).toBe(0);
});

it('preserves modified chat-menu navigation shortcuts without opening, dismissing, or moving focus', () => {
  state.moveOpen = true;
  const items = [{ focus: vi.fn() }, { focus: vi.fn() }];
  vi.stubGlobal('document', { body: {}, activeElement: items[0] });
  const view = ChatMenu({
    chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn(),
  });
  const [trigger, menu] = view.props.children;
  const focus = vi.fn();
  trigger.ref.current = { focus };
  menu.ref.current = { querySelector: () => items[0] };
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft', 'Escape', 'Tab']) {
      const event = {
        key, [modifier]: true, nativeEvent: {},
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
        currentTarget: { querySelectorAll: () => items },
        target: { closest: () => true },
      };
      trigger.props.onKeyDown(event);
      menu.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  }
  state.setters.forEach(setter => expect(setter).not.toHaveBeenCalled());
  items.forEach(item => expect(item.focus).not.toHaveBeenCalled());
  expect(focus).not.toHaveBeenCalled();
});

it('preserves chat actions for modified activation and allows a fresh plain keypress', () => {
  vi.stubGlobal('document', { body: {} });
  const onDelete = vi.fn();
  const view = ChatMenu({ chat: { id: 'chat', title: 'Chat' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete, onExport: vi.fn(), onMove: vi.fn() });
  const menu = view.props.children[1];
  const action = menu.props.children.find((child: any) => child?.key === 'Delete chat');
  const item = { focus: vi.fn() };
  view.props.children[0].ref.current = { focus: vi.fn() };
  const press = (key: string, modifier?: string) => {
    const event = { key, ...(modifier ? { [modifier]: true } : {}), nativeEvent: {},
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { querySelectorAll: () => [item] } };
    menu.props.onKeyDown(event);
    if (!event.preventDefault.mock.calls.length) action.props.onClick({ stopPropagation: vi.fn(), currentTarget: item });
    return event;
  };
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
    for (const key of ['Enter', ' ']) {
      expect(press(key, modifier).preventDefault).toHaveBeenCalledOnce();
      expect(onDelete).not.toHaveBeenCalled();
      expect(state.setters[0]).not.toHaveBeenCalled();
    }
  }
  press('Enter');
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('chat');
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
});

it('links the chat-options trigger to its named popup only while expanded', () => {
  vi.stubGlobal('document', { body: {} });
  const props = { chat: { id: 'chat', title: 'Release planning' } as any, projects: [],
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onMove: vi.fn() };
  const [trigger, menu] = ChatMenu(props).props.children;
  expect(trigger.props['aria-expanded']).toBe(true);
  expect(trigger.props['aria-controls']).toBeTruthy();
  expect(menu.props.id).toBe(trigger.props['aria-controls']);
  expect(menu.props.role).toBe('menu');
  expect(menu.props['aria-label']).toBe('Options for Release planning');

  state.open = false;
  const [closedTrigger, closedMenu] = ChatMenu(props).props.children;
  expect(closedTrigger.props['aria-expanded']).toBe(false);
  expect(closedTrigger.props['aria-controls']).toBeUndefined();
  expect(closedMenu).toBe(false);

  state.open = true;
  const [reopenedTrigger, reopenedMenu] = ChatMenu(props).props.children;
  expect(reopenedMenu.props.id).toBe(menu.props.id);
  expect(reopenedTrigger.props['aria-controls']).toBe(reopenedMenu.props.id);
});
