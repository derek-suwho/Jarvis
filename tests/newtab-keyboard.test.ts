import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ open: true, setOpen: vi.fn(), error: '', setError: vi.fn(), effects: [] as Array<() => void | (() => void)> }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => typeof initial === 'string' ? [state.error, state.setError] : [state.open, state.setOpen],
  useId: () => 'workspace',
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
import { NewTabMenu } from '../src/components/NewTabMenu';

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  state.open = true;
  state.error = '';
  state.effects.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('moves to workspace menu endpoints with Home and End and retains arrow navigation', () => {
  const items = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
  vi.stubGlobal('document', { activeElement: items[1] });
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  const menu = view.props.children[1];
  const key = (value: string) => {
    const event = {
      key: value, preventDefault: vi.fn(), nativeEvent: {},
      currentTarget: { querySelectorAll: () => items },
    };
    menu.props.onKeyDown(event);
    return event;
  };
  expect(key('Home').preventDefault).toHaveBeenCalledOnce();
  expect(items[0].focus).toHaveBeenCalledOnce();
  expect(key('End').preventDefault).toHaveBeenCalledOnce();
  expect(items[3].focus).toHaveBeenCalledOnce();
  expect(key('ArrowDown').preventDefault).toHaveBeenCalledOnce();
  expect(items[2].focus).toHaveBeenCalledOnce();
  expect(key('Enter').preventDefault).not.toHaveBeenCalled();
});


it('opens workspace options with ArrowDown without scrolling the page', () => {
  state.open = false;
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  const trigger = view.props.children[0];
  const event = { key: 'ArrowDown', preventDefault: vi.fn(), nativeEvent: {} };
  trigger.props.onKeyDown?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(state.setOpen).toHaveBeenCalledWith(true);
  state.setOpen.mockClear();
  const unrelated = { key: 'ArrowRight', preventDefault: vi.fn(), nativeEvent: {} };
  trigger.props.onKeyDown(unrelated);
  expect(unrelated.preventDefault).not.toHaveBeenCalled();
  expect(state.setOpen).not.toHaveBeenCalled();
});

it('dismisses workspace options when focus leaves, while preserving internal navigation', () => {
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  const menuItem = {};
  const trigger = {};
  const outside = {};
  const currentTarget = { contains: (target: unknown) => target === menuItem || target === trigger };
  view.props.onBlur?.({ currentTarget, relatedTarget: menuItem });
  view.props.onBlur?.({ currentTarget, relatedTarget: trigger });
  expect(state.setOpen).not.toHaveBeenCalled();
  view.props.onBlur?.({ currentTarget, relatedTarget: outside });
  expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  state.setOpen.mockClear();
  view.props.onBlur?.({ currentTarget, relatedTarget: null });
  expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
});


it('preserves composition and handled Escape before dismissing with ordinary Escape', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  const cleanup = state.effects[0]();
  try {
    for (const properties of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
      const event = { key: 'Escape', preventDefault: vi.fn(), ...properties };
      listeners.get('keydown')!(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(state.setOpen).not.toHaveBeenCalled();
    }
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  } finally {
    cleanup?.();
  }
  expect(listeners.size).toBe(0);
});

it('restores workspace trigger focus before actions so destinations can take focus', () => {
  for (const index of [0, 1, 3, 4]) {
    const order: string[] = [];
    const focus = vi.fn(() => order.push('trigger'));
    const action = vi.fn(() => order.push('destination'));
    const view = NewTabMenu({
      onNewTab: action, onNewTabFull: action, onSideChat: action,
      temporaryOn: false, onTemporaryChat: action,
    });
    view.props.children[0].ref.current = { focus };
    expect(focus).not.toHaveBeenCalled();
    view.props.children[1].props.children[index].props.onClick();
    expect(order).toEqual(['trigger', 'destination']);
    expect(action).toHaveBeenCalledOnce();
    expect(state.setOpen).toHaveBeenLastCalledWith(false);
  }
});

it('preserves composing and already-handled workspace navigation keys', () => {
  const items = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
  vi.stubGlobal('document', { activeElement: items[1] });
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  const trigger = view.props.children[0];
  const menu = view.props.children[1];
  for (const properties of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    const opening = { key: 'ArrowDown', preventDefault: vi.fn(), nativeEvent: properties, ...properties };
    trigger.props.onKeyDown(opening);
    expect(opening.preventDefault).not.toHaveBeenCalled();
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) {
      const event = {
        key, preventDefault: vi.fn(),
        currentTarget: { querySelectorAll: () => items }, nativeEvent: properties, ...properties,
      };
      menu.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  }
  expect(state.setOpen).not.toHaveBeenCalled();
  for (const item of items) expect(item.focus).not.toHaveBeenCalled();
});

it('opens workspace options at the directional endpoint and resets pointer opening to the first action', () => {
  const items = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  (view as unknown as { ref: { current: unknown } }).ref.current = { querySelectorAll: () => items };
  const trigger = view.props.children[0];
  for (const [key, index] of [['ArrowUp', 3], ['ArrowDown', 0]] as const) {
    const event = { key, preventDefault: vi.fn(), nativeEvent: {} };
    trigger.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.setOpen).toHaveBeenCalledWith(true);
    const cleanup = state.effects[0]();
    expect(items[index].focus).toHaveBeenCalledOnce();
    cleanup?.();
    items.forEach((item) => item.focus.mockClear());
  }
  trigger.props.onClick();
  const cleanup = state.effects[0]();
  expect(items[0].focus).toHaveBeenCalledOnce();
  expect(items[3].focus).not.toHaveBeenCalled();
  cleanup?.();
});

it('finds workspace actions by initial letter with wraparound and preserves shortcuts and IME input', () => {
  const items = ['New tab', 'New tab in full view', 'Side chat', 'Turn off temporary chat'].map((label) => ({
    focus: vi.fn(), querySelector: () => ({ textContent: label }),
  }));
  const doc = { activeElement: items[0] };
  vi.stubGlobal('document', doc);
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: true, onTemporaryChat: vi.fn(),
  });
  const key = (value: string, properties = {}) => {
    const event = { key: value, preventDefault: vi.fn(), nativeEvent: {},
      currentTarget: { querySelectorAll: () => items }, ...properties };
    view.props.children[1].props.onKeyDown(event);
    return event;
  };
  expect(key('n').preventDefault).toHaveBeenCalledOnce();
  expect(items[1].focus).toHaveBeenCalledOnce();
  doc.activeElement = items[1];
  expect(key('N').preventDefault).toHaveBeenCalledOnce();
  expect(items[0].focus).toHaveBeenCalledOnce();
  expect(key('t').preventDefault).toHaveBeenCalledOnce();
  expect(items[3].focus).toHaveBeenCalledOnce();
  items.forEach((item) => item.focus.mockClear());
  for (const properties of [{ metaKey: true }, { ctrlKey: true }, { altKey: true },
    { defaultPrevented: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
    expect(key('s', properties).preventDefault).not.toHaveBeenCalled();
  }
  expect(key('z').preventDefault).not.toHaveBeenCalled();
  items.forEach((item) => expect(item.focus).not.toHaveBeenCalled());
  expect(key('s').preventDefault).toHaveBeenCalledOnce();
  expect(items[2].focus).toHaveBeenCalledOnce();
});


it('keeps failed workspace actions focused and reports a safe retryable error', () => {
  const action = vi.fn().mockImplementationOnce(() => { throw new Error('private storage path'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => NewTabMenu({ onNewTab: action, onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  const view = render();
  const focus = vi.fn();
  const event = { currentTarget: { focus } };
  expect(() => view.props.children[1].props.children[0].props.onClick(event)).not.toThrow();
  expect(state.setOpen).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  const failed = render();
  const alert = failed.props.children[1].props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not complete this action. Try again.');
  expect(failed.props.children[1].props.children[0].props['aria-describedby']).toBe(alert.props.id);
  failed.props.children[1].props.children[0].props.onClick(event);
  expect(action).toHaveBeenCalledTimes(2);
  expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.error).toBe('');
});

it('dismisses workspace options on outside touch while preserving inside touches and cleaning up', () => {
  const listeners = new Map<string, (event: any) => void>();
  const addEventListener = vi.fn((name: string, handler: (event: any) => void) => listeners.set(name, handler));
  const removeEventListener = vi.fn((name: string, handler: (event: any) => void) => {
    if (listeners.get(name) === handler) listeners.delete(name);
  });
  vi.stubGlobal('document', { addEventListener, removeEventListener });
  const view = NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  const inside = {};
  (view as any).ref.current = { contains: (target: unknown) => target === inside, querySelectorAll: () => [] };
  const cleanup = state.effects[0]();
  try {
    expect(addEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true });
    listeners.get('touchstart')!({ target: inside });
    expect(state.setOpen).not.toHaveBeenCalled();
    listeners.get('touchstart')!({ target: {} });
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  } finally {
    if (cleanup) cleanup();
  }
  expect(removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it('enters workspace actions at the directional endpoint when no action owns focus', () => {
  const items = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
  vi.stubGlobal('document', { activeElement: {} });
  const view = NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  for (const [key, index] of [['ArrowUp', 3], ['ArrowDown', 0]] as const) {
    items.forEach((item) => item.focus.mockClear());
    const event = { key, preventDefault: vi.fn(), nativeEvent: {},
      currentTarget: { querySelectorAll: () => items } };
    view.props.children[1].props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    items.forEach((item, position) => expect(item.focus).toHaveBeenCalledTimes(position === index ? 1 : 0));
    expect(state.setOpen).not.toHaveBeenCalled();
  }
});

it('dismisses workspace options and clears feedback on app focus loss without taking focus or acting', () => {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener: (name: string, handler: () => void) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
  });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.error = 'Could not complete this action. Try again.';
  const action = vi.fn();
  const view = NewTabMenu({ onNewTab: action, onNewTabFull: action, onSideChat: action,
    temporaryOn: false, onTemporaryChat: action });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  const cleanup = state.effects[0]();
  try {
    expect(listeners.has('blur')).toBe(true);
    listeners.get('blur')!();
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.setError).toHaveBeenCalledExactlyOnceWith('');
    expect(focus).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  } finally {
    cleanup?.();
  }
  expect(listeners.size).toBe(0);
});


it('keeps newly opened workspace options available until a fresh Escape press', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(), temporaryOn: false, onTemporaryChat: vi.fn() });
  const cleanup = state.effects[0]();
  try {
    listeners.get('keydown')!({ key: 'Escape', repeat: true, preventDefault: vi.fn() });
    expect(state.setOpen).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    listeners.get('keydown')!({ key: 'Escape', repeat: false, preventDefault, stopPropagation: vi.fn() });
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(preventDefault).toHaveBeenCalledOnce();
  } finally { if (cleanup) cleanup(); }
  expect(listeners.size).toBe(0);
});

it('hands focus to the workspace trigger before Tab removes the focused menu, preserving native traversal', () => {
  for (const shiftKey of [false, true]) {
    const order: string[] = [];
    const view = NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
      temporaryOn: false, onTemporaryChat: vi.fn() });
    const items = [{ focus: vi.fn() }];
    vi.stubGlobal('document', { activeElement: items[0] });
    view.props.children[0].ref.current = { focus: vi.fn(() => order.push('trigger')) };
    state.setOpen.mockImplementation(() => order.push('close'));
    const event = { key: 'Tab', shiftKey, preventDefault: vi.fn(), nativeEvent: {},
      currentTarget: { querySelectorAll: () => items } };
    view.props.children[1].props.onKeyDown(event);
    expect(order).toEqual(['trigger', 'close']);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.setOpen).toHaveBeenLastCalledWith(false);
    state.setOpen.mockReset();
  }
});

it.each(['Enter', ' '])('requires a fresh %j press to retry a failed workspace action', (key) => {
  const action = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = NewTabMenu({ onNewTab: action, onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  const menu = view.props.children[1];
  const item = { focus: vi.fn() };
  vi.stubGlobal('document', { activeElement: item });
  const press = (repeat: boolean) => {
    const event = { key, repeat, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      currentTarget: { querySelectorAll: () => [item] } };
    menu.props.onKeyDown(event);
    // Model native button activation only when keydown remains uncancelled.
    if (!event.preventDefault.mock.calls.length) menu.props.children[0].props.onClick({ currentTarget: item });
    return event;
  };
  press(false);
  expect(action).toHaveBeenCalledOnce();
  const held = press(true);
  expect(held.preventDefault).toHaveBeenCalledOnce();
  expect(held.stopPropagation).toHaveBeenCalledOnce();
  expect(action).toHaveBeenCalledOnce();
  expect(state.setOpen).not.toHaveBeenCalled();
  press(false);
  expect(action).toHaveBeenCalledTimes(2);
});

it('preserves workspace options for outside context-menu or consumed presses and dismisses on fresh primary input', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const view = NewTabMenu({
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  });
  const inside = {};
  (view as any).ref.current = { contains: (target: unknown) => target === inside, querySelectorAll: () => [] };
  const cleanup = state.effects[0]();
  try {
    listeners.get('mousedown')!({ target: {}, button: 2 });
    expect(state.setOpen).not.toHaveBeenCalled();
    listeners.get('mousedown')!({ target: {}, button: 0, defaultPrevented: true });
    expect(state.setOpen).not.toHaveBeenCalled();
    listeners.get('mousedown')!({ target: inside, button: 0 });
    expect(state.setOpen).not.toHaveBeenCalled();
    listeners.get('mousedown')!({ target: {}, button: 0 });
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
    state.setOpen.mockClear();
    listeners.get('touchstart')!({ target: {} });
    expect(state.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('preserves modified workspace navigation and Escape shortcuts without changing menu focus or state', () => {
  const listeners = new Map<string, (event: any) => void>();
  const items = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
  vi.stubGlobal('document', {
    activeElement: items[0],
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const view = NewTabMenu({ onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn() });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  const cleanup = state.effects[0]();
  try {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const escape = { key: 'Escape', [modifier]: true, preventDefault: vi.fn() };
      listeners.get('keydown')!(escape);
      expect(escape.preventDefault).not.toHaveBeenCalled();
      if (modifier === 'shiftKey') continue;
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) {
        const event = { key, [modifier]: true, nativeEvent: {}, preventDefault: vi.fn(),
          currentTarget: { querySelectorAll: () => items } };
        view.props.children[0].props.onKeyDown(event);
        view.props.children[1].props.onKeyDown(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
    }
    expect(state.setOpen).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    items.forEach((item) => expect(item.focus).not.toHaveBeenCalled());
  } finally { cleanup?.(); }
  expect(listeners.size).toBe(0);
});

it('identifies the workspace popup by name and links it to its trigger only while open', () => {
  const props = {
    onNewTab: vi.fn(), onNewTabFull: vi.fn(), onSideChat: vi.fn(),
    temporaryOn: false, onTemporaryChat: vi.fn(),
  };
  const opened = NewTabMenu(props);
  const trigger = opened.props.children[0];
  const menu = opened.props.children[1];
  expect(menu.props['aria-label']).toBe('Workspace options');
  expect(menu.props.id).toBeTruthy();
  expect(trigger.props['aria-controls']).toBe(menu.props.id);
  expect(trigger.props['aria-expanded']).toBe(true);
  state.open = false;
  const closed = NewTabMenu(props);
  expect(closed.props.children[0].props['aria-expanded']).toBe(false);
  expect(closed.props.children[0].props['aria-controls']).toBeUndefined();
  expect(closed.props.children[1]).toBe(false);
});
