import { afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, setState: vi.fn(), query: '', open: true, error: null as string | null }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial === false ? lifecycle.open : initial === '' ? lifecycle.query : initial === null ? lifecycle.error : initial, lifecycle.setState],
  useId: () => 'model-picker-dialog',
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
import { ModelPicker } from '../src/components/ModelPicker';
import { DEFAULT_SETTINGS } from '../src/lib/models';

afterEach(() => {
  lifecycle.effects.length = 0;
  lifecycle.query = '';
  lifecycle.open = true;
  lifecycle.error = null;
  lifecycle.setState.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the model search open while Escape cancels IME composition', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  ModelPicker({ value: DEFAULT_SETTINGS, onChange: vi.fn() });
  const cleanup = lifecycle.effects[0]();
  const key = (isComposing: boolean, keyCode: number) => {
    const event = { key: 'Escape', isComposing, keyCode, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(event);
    return event;
  };
  try {
    expect(key(true, 27).preventDefault).not.toHaveBeenCalled();
    expect(key(false, 229).preventDefault).not.toHaveBeenCalled();
    expect(lifecycle.setState).not.toHaveBeenCalled();
    expect(key(false, 27).preventDefault).toHaveBeenCalledOnce();
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});


it('preserves model selection when a child has already handled Escape', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const onChange = vi.fn();
  ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const cleanup = lifecycle.effects[0]();
  try {
    const event = { key: 'Escape', defaultPrevented: true, isComposing: false, keyCode: 27,
      preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(event);
    expect(lifecycle.setState).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    listeners.get('keydown')!({ ...event, defaultPrevented: false });
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('leaves model-search arrows with IME composition and preserves ordinary model navigation', () => {
  const focus = [vi.fn(), vi.fn()];
  const options = focus.map((focus) => ({ focus }));
  const input = {};
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('document', { body: {}, activeElement: input });
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange: vi.fn() });
  const panel = view.props.children[1];
  panel.ref.current = { querySelectorAll: () => options };
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = { key, target: input, nativeEvent, preventDefault: vi.fn() };
      panel.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(focus[0]).not.toHaveBeenCalled();
      expect(focus[1]).not.toHaveBeenCalled();
    }
  }
  for (const [key, index] of [['ArrowDown', 0], ['ArrowUp', 1]] as const) {
    const event = { key, target: input, nativeEvent: {}, preventDefault: vi.fn() };
    panel.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus[index]).toHaveBeenCalledOnce();
  }
});

it('preserves modified text-navigation arrows in model search', () => {
  const focus = vi.fn();
  const input = {};
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('document', { body: {}, activeElement: input });
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange: vi.fn() });
  const panel = view.props.children[1];
  panel.ref.current = { querySelectorAll: () => [{ focus }] };
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    for (const key of ['ArrowDown', 'ArrowUp']) {
      const event = { key, [modifier]: true, target: input, nativeEvent: {}, preventDefault: vi.fn() };
      panel.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    }
  }
});

it('dismisses model selection on outside touch while preserving touches in the panel and trigger', () => {
  const listeners = new Map<string, (event: any) => void>();
  const addEventListener = vi.fn((name: string, handler: (event: any) => void) => listeners.set(name, handler));
  vi.stubGlobal('document', {
    body: {}, addEventListener,
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const trigger = view.props.children[0];
  const panel = view.props.children[1];
  const insidePanel = {};
  const insideTrigger = {};
  const focus = vi.fn();
  panel.ref.current = { contains: (node: unknown) => node === insidePanel };
  trigger.ref.current = { contains: (node: unknown) => node === insideTrigger, focus };
  const cleanup = lifecycle.effects[0]();
  try {
    expect(addEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true });
    listeners.get('touchstart')!({ target: insidePanel });
    listeners.get('touchstart')!({ target: insideTrigger });
    expect(lifecycle.setState).not.toHaveBeenCalled();
    listeners.get('touchstart')!({ target: {} });
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(lifecycle.setState).toHaveBeenCalledWith('');
    expect(onChange).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});


it('preserves Shift-arrow text selection in model search', () => {
  const focus = vi.fn();
  const input = {};
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('document', { body: {}, activeElement: input });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const panel = view.props.children[1];
  panel.ref.current = { querySelectorAll: () => [{ focus }] };
  for (const key of ['ArrowDown', 'ArrowUp']) {
    const event = { key, shiftKey: true, target: input, nativeEvent: {}, preventDefault: vi.fn() };
    panel.props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  }
  expect(onChange).not.toHaveBeenCalled();
  const arrow = { key: 'ArrowDown', target: input, nativeEvent: {}, preventDefault: vi.fn() };
  panel.props.onKeyDown(arrow);
  expect(arrow.preventDefault).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
});

it('respects arrow keys already consumed by a child control', () => {
  const focus = vi.fn();
  const input = {};
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('document', { body: {}, activeElement: input });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const panel = view.props.children[1];
  panel.ref.current = { querySelectorAll: () => [{ focus }] };
  for (const key of ['ArrowDown', 'ArrowUp']) {
    const event = { key, defaultPrevented: true, target: input, nativeEvent: {}, preventDefault: vi.fn() };
    panel.props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  }
  expect(onChange).not.toHaveBeenCalled();
  const event = { key: 'ArrowDown', defaultPrevented: false, target: input, nativeEvent: {}, preventDefault: vi.fn() };
  panel.props.onKeyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
});

it('announces an empty model search without offering an unavailable choice', () => {
  lifecycle.query = 'no-such-model-987654';
  vi.stubGlobal('document', { body: {} });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const panel = view.props.children[1];
  const list = panel.props.children[1];
  const empty = list.props.children[2];
  expect(empty.props.children.join('')).toBe('No models match “no-such-model-987654”.');
  expect(empty.props.role).toBe('status');
  expect(list.props.children[0]).toBe(false);
  expect(list.props.children[1]).toEqual([]);
  expect(onChange).not.toHaveBeenCalled();
});

it('dismisses a detached model picker on outside scrolling while preserving model-list scrolling', () => {
  const listeners = new Map<string, (event: any) => void>();
  const removeEventListener = vi.fn((name: string) => listeners.delete(name));
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener,
  });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const inside = {};
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  view.props.children[1].ref.current = { contains: (node: unknown) => node === inside };
  const cleanup = lifecycle.effects[0]();
  try {
    expect(listeners.has('scroll')).toBe(true);
    listeners.get('scroll')!({ target: inside });
    expect(lifecycle.setState).not.toHaveBeenCalled();
    listeners.get('scroll')!({ target: {} });
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(lifecycle.setState).toHaveBeenCalledWith('');
    expect(focus).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  expect(listeners.size).toBe(0);
});

it('moves focused model choices to Home/End endpoints while preserving search editing and native selects', () => {
  const options = Array.from({ length: 3 }, () => ({ focus: vi.fn() }));
  const input = {};
  class Select {}
  vi.stubGlobal('HTMLSelectElement', Select);
  const doc = { body: {}, activeElement: options[1] as unknown };
  vi.stubGlobal('document', doc);
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const panel = view.props.children[1];
  panel.ref.current = { querySelectorAll: () => options };
  const key = (key: string, target: unknown, properties = {}) => {
    doc.activeElement = target;
    const event = { key, target, nativeEvent: {}, preventDefault: vi.fn(), ...properties };
    panel.props.onKeyDown(event);
    return event;
  };
  expect(key('Home', options[1]).preventDefault).toHaveBeenCalledOnce();
  expect(options[0].focus).toHaveBeenCalledOnce();
  expect(key('End', options[1]).preventDefault).toHaveBeenCalledOnce();
  expect(options[2].focus).toHaveBeenCalledOnce();
  options.forEach((option) => option.focus.mockClear());
  for (const name of ['Home', 'End']) {
    expect(key(name, input).preventDefault).not.toHaveBeenCalled();
    expect(key(name, new Select()).preventDefault).not.toHaveBeenCalled();
    for (const properties of [{ shiftKey: true }, { ctrlKey: true }, { defaultPrevented: true },
      { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
      expect(key(name, options[1], properties).preventDefault).not.toHaveBeenCalled();
    }
  }
  options.forEach((option) => expect(option.focus).not.toHaveBeenCalled());
  expect(onChange).not.toHaveBeenCalled();
});

it('dismisses model search on window interruption without changing selection or stealing focus', () => {
  lifecycle.query = 'Claude';
  const listeners = new Map<string, (event: any) => void>();
  const removeEventListener = vi.fn((name: string, handler: (event: any) => void) => {
    if (listeners.get(name) === handler) listeners.delete(name);
  });
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener,
  });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  const cleanup = lifecycle.effects[0]();
  try {
    expect(listeners.has('blur')).toBe(true);
    listeners.get('blur')!({});
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(lifecycle.setState).toHaveBeenCalledWith('');
    expect(focus).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it('retains the model picker after a failed settings save and allows a successful retry', () => {
  vi.stubGlobal('document', { body: {} });
  lifecycle.setState.mockImplementation((value: unknown) => {
    if (value === null || typeof value === 'string' && value !== '') lifecycle.error = value as string | null;
  });
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const panel = view.props.children[1];
  const auto = panel.props.children[1].props.children[0];
  expect(() => auto.props.onClick()).not.toThrow();
  expect(lifecycle.setState).toHaveBeenCalledWith('Could not save model settings. Try again.');
  expect(lifecycle.setState).not.toHaveBeenCalledWith(false);
  const failed = ModelPicker({ value: DEFAULT_SETTINGS, onChange }).props.children[1];
  expect(failed.props.children.find((child: any) => child?.props?.role === 'alert')?.props.children)
    .toBe('Could not save model settings. Try again.');
  lifecycle.setState.mockClear();
  auto.props.onClick();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(lifecycle.setState).toHaveBeenCalledWith(null);
  expect(lifecycle.setState).toHaveBeenCalledWith(false);
});

it('dismisses model options when focus leaves the trigger while preserving movement into the portal', () => {
  vi.stubGlobal('document', { body: {} });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const trigger = view.props.children[0];
  const panel = view.props.children[1];
  const inside = {};
  const outside = { focus: vi.fn() };
  const triggerFocus = vi.fn();
  trigger.ref.current = { focus: triggerFocus };
  panel.ref.current = { contains: (node: unknown) => node === inside };
  trigger.props.onBlur?.({ relatedTarget: inside });
  expect(lifecycle.setState).not.toHaveBeenCalled();
  for (const relatedTarget of [outside, null]) {
    lifecycle.setState.mockClear();
    trigger.props.onBlur?.({ relatedTarget });
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(lifecycle.setState).toHaveBeenCalledWith('');
    expect(lifecycle.setState).toHaveBeenCalledWith(null);
  }
  expect(triggerFocus).not.toHaveBeenCalled();
  expect(outside.focus).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it('preserves model search during outside context-menu or consumed presses and dismisses on primary input', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    body: {},
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const focus = vi.fn();
  const inside = {};
  view.props.children[0].ref.current = { contains: () => false, focus };
  view.props.children[1].ref.current = { contains: (node: unknown) => node === inside };
  const cleanup = lifecycle.effects[0]();
  try {
    for (const event of [
      { button: 2 }, { button: 1 }, { button: 0, defaultPrevented: true }, { button: 0, target: inside },
    ]) {
      listeners.get('mousedown')!({ target: {}, ...event });
      expect(lifecycle.setState).not.toHaveBeenCalled();
    }
    listeners.get('mousedown')!({ target: {}, button: 0 });
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(lifecycle.setState).toHaveBeenCalledWith('');
    expect(onChange).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('preserves model search and focus during modified Escape shortcuts', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    body: {},
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const focus = vi.fn();
  view.props.children[0].ref.current = { focus };
  const cleanup = lifecycle.effects[0]();
  try {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const event = { key: 'Escape', [modifier]: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      listeners.get('keydown')!(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(lifecycle.setState).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    }
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(lifecycle.setState).toHaveBeenCalledWith(false);
    expect(focus).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});


it('connects the model trigger to its named dialog only while expanded', () => {
  vi.stubGlobal('document', { body: {} });
  const onChange = vi.fn();
  const view = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  const trigger = view.props.children[0];
  const dialog = view.props.children[1];
  expect(trigger.props['aria-expanded']).toBe(true);
  expect(trigger.props['aria-controls']).toBeTruthy();
  expect(dialog.props.id).toBe(trigger.props['aria-controls']);
  expect(dialog.props.role).toBe('dialog');
  expect(dialog.props['aria-label']).toBe('Choose a model');

  lifecycle.open = false;
  const closed = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  expect(closed.props.children[0].props['aria-expanded']).toBe(false);
  expect(closed.props.children[0].props['aria-controls']).toBeUndefined();
  expect(closed.props.children[1]).toBe(false);

  lifecycle.open = true;
  const reopened = ModelPicker({ value: DEFAULT_SETTINGS, onChange });
  expect(reopened.props.children[0].props['aria-controls']).toBe(dialog.props.id);
  expect(reopened.props.children[1].props.id).toBe(dialog.props.id);
  expect(onChange).not.toHaveBeenCalled();
});
