import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));
import { ResizeHandle } from '../src/components/ResizeHandle';

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.unstubAllGlobals();
});

it.each(['capture loss', 'unmount'])('ends an interrupted resize on %s', (interruption) => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  handle.props.onPointerDown({ preventDefault: vi.fn(), currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() }, button: 0, pointerId: 1, clientX: 100 });
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  expect(onResize).toHaveBeenLastCalledWith(260);
  expect(classes.has('resizing')).toBe(true);
  if (interruption === 'capture loss') handle.props.onLostPointerCapture?.({ pointerId: 1 });
  else cleanup.forEach((dispose) => dispose?.());
  expect(classes.has('resizing')).toBe(false);
  onResize.mockClear();
  handle.props.onPointerMove({ pointerId: 1, clientX: 150 });
  expect(onResize).not.toHaveBeenCalled();
  if (interruption === 'capture loss') cleanup.forEach((dispose) => dispose?.());
});

it('ignores secondary-button presses without capturing or resizing', () => {
  const add = vi.fn();
  vi.stubGlobal('document', { body: { classList: { add, remove: vi.fn() } } });
  const onResize = vi.fn();
  const setPointerCapture = vi.fn();
  const preventDefault = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  handle.props.onPointerDown({ button: 2, preventDefault, currentTarget: { focus: vi.fn(), setPointerCapture }, pointerId: 1, clientX: 100 });
  handle.props.onPointerMove({ pointerId: 1, clientX: 140 });
  expect(setPointerCapture).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();
});

it('keeps an active resize owned by its initiating pointer', () => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const down = (pointerId: number, clientX: number) => ({
    button: 0, pointerId, clientX, preventDefault: vi.fn(), currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() },
  });
  handle.props.onPointerDown(down(1, 100));
  const second = down(2, 200);
  handle.props.onPointerDown(second);
  expect(second.currentTarget.setPointerCapture).not.toHaveBeenCalled();
  handle.props.onPointerMove({ pointerId: 2, clientX: 250 });
  expect(onResize).not.toHaveBeenCalled();
  handle.props.onPointerUp({ pointerId: 2 });
  handle.props.onPointerCancel({ pointerId: 2 });
  handle.props.onLostPointerCapture({ pointerId: 2 });
  expect(classes.has('resizing')).toBe(true);
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  expect(onResize).toHaveBeenLastCalledWith(260);
  handle.props.onPointerUp({ pointerId: 1 });
  expect(classes.has('resizing')).toBe(false);
  onResize.mockClear();
  handle.props.onPointerMove({ pointerId: 1, clientX: 150 });
  expect(onResize).not.toHaveBeenCalled();
});

it.each(['left', 'right'] as const)('resets the %s panel width with Enter while preserving arrow resizing', (edge) => {
  const onResize = vi.fn();
  const onReset = vi.fn();
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => 240, onResize, onReset });
  const press = (key: string) => {
    const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    handle.props.onKeyDown(event);
    return event;
  };
  expect(press('Enter').preventDefault).toHaveBeenCalledOnce();
  expect(onReset).toHaveBeenCalledOnce();
  expect(onResize).not.toHaveBeenCalled();
  expect(press('ArrowLeft').preventDefault).toHaveBeenCalledOnce();
  expect(onResize).toHaveBeenLastCalledWith(edge === 'right' ? 224 : 256);
  expect(press('ArrowRight').preventDefault).toHaveBeenCalledOnce();
  expect(onResize).toHaveBeenLastCalledWith(edge === 'right' ? 256 : 224);
  expect(press('Tab').preventDefault).not.toHaveBeenCalled();
  expect(onReset).toHaveBeenCalledOnce();
});

it('ends resizing when the application window loses focus and removes its listener on unmount', () => {
  const classes = new Set<string>();
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const removeEventListener = vi.fn((name: string, handler: () => void) => {
    if (listeners.get(name) === handler) listeners.delete(name);
  });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener,
  });
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  try {
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() } });
    handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
    expect(onResize).toHaveBeenLastCalledWith(260);
    listeners.get('blur')?.();
    expect(classes.has('resizing')).toBe(false);
    onResize.mockClear();
    handle.props.onPointerMove({ pointerId: 1, clientX: 160 });
    expect(onResize).not.toHaveBeenCalled();
  } finally {
    cleanup.forEach((dispose) => dispose?.());
  }
  expect(removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it('cancels an active panel drag with Escape without consuming idle or unrelated keys', () => {
  const classes = new Set<string>();
  const listeners = new Map<string, (event: { key: string; preventDefault: () => void }) => void>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: { key: string; preventDefault: () => void }) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  const press = (key: string) => {
    const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    listeners.get('keydown')?.(event);
    return event;
  };
  try {
    expect(press('Escape').preventDefault).not.toHaveBeenCalled();
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() } });
    expect(press('ArrowRight').preventDefault).not.toHaveBeenCalled();
    expect(classes.has('resizing')).toBe(true);
    expect(press('Escape').preventDefault).toHaveBeenCalledOnce();
    expect(classes.has('resizing')).toBe(false);
    handle.props.onPointerMove({ pointerId: 1, clientX: 180 });
    expect(onResize).not.toHaveBeenCalled();
  } finally {
    cleanup.forEach((dispose) => dispose?.());
  }
  expect(listeners.size).toBe(0);
});

it('releases pointer capture when Escape cancels a drag and permits a fresh drag', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  const captured = new Set<number>();
  const target = {
    focus: vi.fn(),
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => {
      captured.delete(id);
      handle.props.onLostPointerCapture({ pointerId: id });
    }),
  };
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  const down = (pointerId: number) => handle.props.onPointerDown({ button: 0, pointerId, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  try {
    down(1);
    listeners.get('keydown')?.({ key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    expect(captured.size).toBe(0);
    handle.props.onPointerMove({ pointerId: 1, clientX: 150 });
    expect(onResize).not.toHaveBeenCalled();
    down(2);
    handle.props.onPointerMove({ pointerId: 2, clientX: 120 });
    expect(onResize).toHaveBeenLastCalledWith(260);
    handle.props.onPointerUp({ pointerId: 2 });
    expect(captured.size).toBe(0);
  } finally {
    cleanup.forEach((dispose) => dispose?.());
  }
});

it('preserves panel widths for composing and already-handled keyboard events', () => {
  const onResize = vi.fn();
  const onReset = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset });
  for (const flags of [
    { nativeEvent: { isComposing: true } },
    { nativeEvent: { isComposing: false, keyCode: 229 } },
    { defaultPrevented: true, nativeEvent: {} },
  ]) {
    for (const key of ['Enter', 'ArrowLeft', 'ArrowRight']) {
      const event = { key, ...flags, preventDefault: vi.fn() };
      handle.props.onKeyDown(event);
      expect(onReset).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  }
  const enter = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  handle.props.onKeyDown(enter);
  expect(onReset).toHaveBeenCalledOnce();
  expect(enter.preventDefault).toHaveBeenCalledOnce();
});


it('preserves an active drag when Escape belongs to composition or another control', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  const releasePointerCapture = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture };
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  try {
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
    for (const flags of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
      const event = { key: 'Escape', ...flags, preventDefault: vi.fn() };
      listeners.get('keydown')?.(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(releasePointerCapture).not.toHaveBeenCalled();
      handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
      expect(onResize).toHaveBeenLastCalledWith(260);
    }
    const escape = { key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() };
    listeners.get('keydown')?.(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    onResize.mockClear();
    handle.props.onPointerMove({ pointerId: 1, clientX: 160 });
    expect(onResize).not.toHaveBeenCalled();
  } finally {
    cleanup.forEach((dispose) => dispose?.());
  }
  expect(listeners.size).toBe(0);
});

it('preserves modified shortcuts while ordinary panel resize keys remain usable', () => {
  const onResize = vi.fn();
  const onReset = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset });
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Enter']) {
      const event = { key, [modifier]: true, preventDefault: vi.fn() };
      handle.props.onKeyDown(event);
      expect(onResize).not.toHaveBeenCalled();
      expect(onReset).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  }
  const arrow = { key: 'ArrowRight', preventDefault: vi.fn() };
  handle.props.onKeyDown(arrow);
  expect(onResize).toHaveBeenCalledExactlyOnceWith(256);
  expect(arrow.preventDefault).toHaveBeenCalledOnce();
  const enter = { key: 'Enter', preventDefault: vi.fn() };
  handle.props.onKeyDown(enter);
  expect(onReset).toHaveBeenCalledOnce();
  expect(enter.preventDefault).toHaveBeenCalledOnce();
});

it('hands an active pointer resize over to the keyboard without later pointer jumps', () => {
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter']) {
    let width = 240;
    let captured = false;
    const target = {
      focus: vi.fn(),
      setPointerCapture: () => { captured = true; },
      hasPointerCapture: () => captured,
      releasePointerCapture: vi.fn(() => { captured = false; }),
    };
    const onResize = vi.fn((next: number) => { width = next; });
    const onReset = vi.fn(() => { width = 240; });
    const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => width, onResize, onReset });
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
    handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
    expect(width).toBe(260);
    handle.props.onKeyDown({ key, preventDefault: vi.fn() });
    expect(width).toBe(key === 'Enter' ? 240 : key === 'ArrowLeft' ? 244 : 276);
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    onResize.mockClear();
    handle.props.onPointerMove({ pointerId: 1, clientX: 180 });
    expect(onResize).not.toHaveBeenCalled();
  }
});


it('focuses the separator on pointer resize so keyboard operation can follow a drag', () => {
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  let focused = false;
  const target = {
    focus: vi.fn(() => { focused = true; }),
    setPointerCapture: vi.fn(),
  };
  let width = 240;
  const onResize = vi.fn((next: number) => { width = next; });
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => width, onResize, onReset: vi.fn() });
  const down = { button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target };
  handle.props.onPointerDown(down);
  expect(down.preventDefault).toHaveBeenCalledOnce();
  expect(target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  handle.props.onPointerUp({ pointerId: 1 });
  if (focused) handle.props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() });
  expect(width).toBe(276);
});

it('ends an active drag when double-click restores the default panel width', () => {
  const remove = vi.fn();
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove } } });
  let width = 240;
  let captured = false;
  const target = {
    focus: vi.fn(),
    setPointerCapture: () => { captured = true; },
    hasPointerCapture: () => captured,
    releasePointerCapture: vi.fn(() => { captured = false; }),
  };
  const onResize = vi.fn((next: number) => { width = next; });
  const onReset = vi.fn(() => { width = 240; });
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => width, onResize, onReset });
  handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  expect(width).toBe(260);
  handle.props.onDoubleClick({ button: 0, defaultPrevented: false });
  expect(onReset).toHaveBeenCalledOnce();
  expect(width).toBe(240);
  handle.props.onPointerMove({ pointerId: 1, clientX: 180 });
  expect(width).toBe(240);
  expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  expect(remove).toHaveBeenCalledWith('resizing');
  handle.props.onPointerDown({ button: 0, pointerId: 2, clientX: 200, preventDefault: vi.fn(), currentTarget: target });
  handle.props.onPointerMove({ pointerId: 2, clientX: 216 });
  expect(width).toBe(256);
  handle.props.onPointerUp({ pointerId: 2 });
  expect(captured).toBe(false);
});

it('ends a drag when keyboard focus leaves the resize handle', () => {
  const remove = vi.fn();
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove } } });
  const onResize = vi.fn();
  const releasePointerCapture = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const down = () => handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  down();
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  expect(onResize).toHaveBeenLastCalledWith(260);
  handle.props.onBlur?.();
  expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  expect(remove).toHaveBeenCalledWith('resizing');
  onResize.mockClear();
  handle.props.onPointerMove({ pointerId: 1, clientX: 180 });
  expect(onResize).not.toHaveBeenCalled();
  down();
  handle.props.onPointerMove({ pointerId: 1, clientX: 130 });
  expect(onResize).toHaveBeenLastCalledWith(270);
  handle.props.onPointerUp({ pointerId: 1 });
});

it('exposes measured panel width and bounds to assistive technology as layout changes', () => {
  let width = 256;
  let notify!: () => void;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => width,
    minWidth: 200, maxWidth: 480, onResize: vi.fn(), onReset: vi.fn() });
  const panel = {};
  const setAttribute = vi.fn();
  const ref = (handle as any).ref;
  if (ref) ref.current = { parentElement: panel, setAttribute };
  const cleanup = lifecycle.effects.map((effect) => effect());
  expect(handle.props['aria-valuemin']).toBe(200);
  expect(handle.props['aria-valuemax']).toBe(480);
  expect(setAttribute).toHaveBeenCalledWith('aria-valuenow', '256');
  expect(observe).toHaveBeenCalledWith(panel);
  width = 320;
  notify();
  expect(setAttribute).toHaveBeenLastCalledWith('aria-valuenow', '320');
  cleanup.forEach((dispose) => dispose?.());
  expect(disconnect).toHaveBeenCalledOnce();
});

it.each(['left', 'right'] as const)('reaches configured width bounds with Home and End on the %s edge', (edge) => {
  let width = 280;
  const onResize = vi.fn((next: number) => { width = next; });
  const onReset = vi.fn();
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => width,
    minWidth: 200, maxWidth: 480, onResize, onReset });
  for (const [key, expected] of [['Home', 200], ['End', 480]] as const) {
    const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    handle.props.onKeyDown(event);
    expect(width).toBe(expected);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
  expect(onReset).not.toHaveBeenCalled();
  const modified = { key: 'Home', metaKey: true, preventDefault: vi.fn() };
  handle.props.onKeyDown(modified);
  expect(width).toBe(480);
  expect(modified.preventDefault).not.toHaveBeenCalled();
  const unbounded = ResizeHandle({ label: 'Panel width', edge, measure: () => width, onResize, onReset });
  onResize.mockClear();
  const event = { key: 'End', preventDefault: vi.fn() };
  unbounded.props.onKeyDown(event);
  expect(onResize).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it.each(['left', 'right'] as const)('keeps pointer and keyboard resize requests within advertised bounds on the %s edge', (edge) => {
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  let width = 240;
  const onResize = vi.fn((next: number) => { width = next; });
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => width,
    minWidth: 200, maxWidth: 480, onResize, onReset: vi.fn() });
  const target = { focus: vi.fn(), setPointerCapture: vi.fn() };
  handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  const sign = edge === 'right' ? 1 : -1;
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 + sign * 1000 });
  expect(width).toBe(480);
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 - sign * 1000 });
  expect(width).toBe(200);
  handle.props.onPointerUp({ pointerId: 1 });
  width = 205;
  handle.props.onKeyDown({ key: edge === 'right' ? 'ArrowLeft' : 'ArrowRight', preventDefault: vi.fn() });
  expect(width).toBe(200);
  width = 475;
  handle.props.onKeyDown({ key: edge === 'right' ? 'ArrowRight' : 'ArrowLeft', preventDefault: vi.fn() });
  expect(width).toBe(480);
});

it.each(['left', 'right'] as const)('commits the final release position when the last move was coalesced on the %s edge', (edge) => {
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  let width = 240;
  const onResize = vi.fn((next: number) => { width = next; });
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => width,
    minWidth: 200, maxWidth: 480, onResize, onReset: vi.fn() });
  const sign = edge === 'right' ? 1 : -1;
  handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 + sign * 10 });
  expect(width).toBe(250);
  handle.props.onPointerUp({ pointerId: 2, clientX: 100 + sign * 1000 });
  expect(width).toBe(250);
  handle.props.onPointerUp({ pointerId: 1, clientX: 100 + sign * 40 });
  expect(width).toBe(280);
  expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 + sign * 80 });
  expect(width).toBe(280);
});

it('preserves focus and panel width when another handler consumed the pointer press', () => {
  const add = vi.fn();
  vi.stubGlobal('document', { body: { classList: { add, remove: vi.fn() } } });
  const onResize = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn() };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const down = { button: 0, pointerId: 1, clientX: 100, defaultPrevented: true, preventDefault: vi.fn(), currentTarget: target };
  handle.props.onPointerDown(down);
  handle.props.onPointerMove({ pointerId: 1, clientX: 140 });
  handle.props.onPointerUp({ pointerId: 1, clientX: 160 });
  expect(target.focus).not.toHaveBeenCalled();
  expect(target.setPointerCapture).not.toHaveBeenCalled();
  expect(down.preventDefault).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();
  handle.props.onPointerDown({ ...down, defaultPrevented: false });
  handle.props.onPointerMove({ pointerId: 1, clientX: 120 });
  expect(target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(onResize).toHaveBeenCalledExactlyOnceWith(260);
  handle.props.onPointerUp({ pointerId: 1 });
});

it('abandons a drag if the pointer expires before capture and permits a fresh drag', () => {
  const add = vi.fn();
  vi.stubGlobal('document', { body: { classList: { add, remove: vi.fn() } } });
  const onResize = vi.fn();
  const target = {
    focus: vi.fn(),
    setPointerCapture: vi.fn().mockImplementationOnce(() => { throw new DOMException('Pointer inactive', 'NotFoundError'); }),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const down = (pointerId: number) => ({ button: 0, pointerId, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
  expect(() => handle.props.onPointerDown(down(1))).not.toThrow();
  handle.props.onPointerMove({ pointerId: 1, clientX: 140 });
  handle.props.onPointerUp({ pointerId: 1, clientX: 150 });
  expect(onResize).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  handle.props.onPointerDown(down(2));
  handle.props.onPointerMove({ pointerId: 2, clientX: 120 });
  expect(onResize).toHaveBeenCalledExactlyOnceWith(260);
  handle.props.onPointerUp({ pointerId: 2, clientX: 120 });
  expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(2);
});

it('preserves the saved panel width for secondary or consumed double-clicks and resets on a fresh primary double-click', () => {
  const onReset = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 320,
    onResize: vi.fn(), onReset });
  for (const event of [{ button: 2 }, { button: 1 }, { button: 0, defaultPrevented: true }]) {
    handle.props.onDoubleClick(event);
    expect(onReset).not.toHaveBeenCalled();
  }
  handle.props.onDoubleClick({ button: 0, defaultPrevented: false });
  expect(onReset).toHaveBeenCalledOnce();
});

it('recovers a missed pointer release without resizing and permits a fresh drag', () => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const onResize = vi.fn();
  const releasePointerCapture = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const down = () => handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
  down();
  handle.props.onPointerMove({ pointerId: 1, clientX: 120, buttons: 1 });
  expect(onResize).toHaveBeenLastCalledWith(260);
  onResize.mockClear();
  // The release was not delivered; the next move reports the physical button state.
  handle.props.onPointerMove({ pointerId: 1, clientX: 180, buttons: 0 });
  expect(onResize).not.toHaveBeenCalled();
  expect(classes.has('resizing')).toBe(false);
  expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  handle.props.onPointerMove({ pointerId: 1, clientX: 190, buttons: 1 });
  expect(onResize).not.toHaveBeenCalled();
  down();
  handle.props.onPointerMove({ pointerId: 1, clientX: 130, buttons: 1 });
  expect(onResize).toHaveBeenCalledExactlyOnceWith(270);
  handle.props.onPointerUp({ pointerId: 1, clientX: 130 });
  expect(classes.has('resizing')).toBe(false);
});

it('preserves modified Escape shortcuts during a drag while plain Escape releases capture', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const onResize = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  const cleanup = lifecycle.effects.map((effect) => effect());
  try {
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const event = { key: 'Escape', [modifier]: true, preventDefault: vi.fn() };
      listeners.get('keydown')!(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(target.releasePointerCapture).not.toHaveBeenCalled();
      expect(classes.has('resizing')).toBe(true);
    }
    handle.props.onPointerMove({ pointerId: 1, clientX: 120, buttons: 1 });
    expect(onResize).toHaveBeenLastCalledWith(260);
    const escape = { key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() };
    listeners.get('keydown')!(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    expect(classes.has('resizing')).toBe(false);
    onResize.mockClear();
    handle.props.onPointerMove({ pointerId: 1, clientX: 180, buttons: 1 });
    expect(onResize).not.toHaveBeenCalled();
  } finally {
    cleanup.forEach((dispose) => dispose?.());
  }
});

it('explains keyboard resizing and exposes the rendered width in pixels as panels change', () => {
  let update!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { update = callback; }
    observe() {}
    disconnect() {}
  });
  let width = 256;
  const handle = ResizeHandle({ label: 'Resize sidebar', edge: 'right', measure: () => width,
    minWidth: 200, maxWidth: 480, onResize: vi.fn(), onReset: vi.fn() });
  expect(handle.props['aria-description']).toBe('Use Left and Right arrows to resize, Home and End for minimum and maximum width, or Enter to restore the default width.');
  const attributes = new Map<string, string>();
  (handle as any).ref.current = { parentElement: {}, setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const cleanup = lifecycle.effects[0]();
  expect(attributes.get('aria-valuetext')).toBe('256 pixels');
  width = 319.6;
  update();
  expect(attributes.get('aria-valuetext')).toBe('320 pixels');
  expect(attributes.get('aria-valuenow')).toBe('320');
  cleanup?.();
});

it('ends a resize when the primary button is released while a secondary button remains held', () => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  const onResize = vi.fn();
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 240, onResize, onReset: vi.fn() });
  handle.props.onPointerDown({ button: 0, buttons: 1, pointerId: 1, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
  handle.props.onPointerMove({ buttons: 3, pointerId: 1, clientX: 120 });
  expect(onResize).toHaveBeenLastCalledWith(260);
  onResize.mockClear();
  // Mouse pointerup waits for all buttons: movement first reports primary release.
  handle.props.onPointerMove({ buttons: 2, pointerId: 1, clientX: 150 });
  expect(onResize).not.toHaveBeenCalled();
  expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  expect(classes.has('resizing')).toBe(false);
  handle.props.onPointerUp({ button: 2, buttons: 0, pointerId: 1, clientX: 160 });
  expect(onResize).not.toHaveBeenCalled();
  handle.props.onPointerDown({ button: 0, buttons: 1, pointerId: 2, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
  handle.props.onPointerUp({ button: 0, buttons: 0, pointerId: 2, clientX: 130 });
  expect(onResize).toHaveBeenLastCalledWith(270);
  expect(classes.has('resizing')).toBe(false);
});

it.each(['left', 'right'] as const)('restores the original %s panel width when Escape cancels a moved drag', (edge) => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  let width = 280;
  const onResize = vi.fn((next: number) => { width = next; });
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => width, minWidth: 180, maxWidth: 480, onResize, onReset: vi.fn() });
  const cleanups = lifecycle.effects.map(effect => effect());
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  try {
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, preventDefault: vi.fn(), currentTarget: target });
    handle.props.onPointerMove({ pointerId: 1, clientX: 140, buttons: 1 });
    expect(width).toBe(edge === 'right' ? 320 : 240);
    listeners.get('keydown')!({ key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(width).toBe(280);
    expect(onResize).toHaveBeenLastCalledWith(280);
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    handle.props.onPointerUp({ pointerId: 1, clientX: 150 });
    handle.props.onPointerMove({ pointerId: 1, clientX: 160, buttons: 1 });
    expect(width).toBe(280);
  } finally { cleanups.forEach(cleanup => cleanup?.()); }
});

it.each(['left', 'right'] as const)('rolls back a system-cancelled drag on the %s edge and permits a fresh drag', (edge) => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  let width = 280;
  const onResize = vi.fn((next: number) => { width = next; });
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const handle = ResizeHandle({ label: 'Panel width', edge, measure: () => width,
    minWidth: 180, maxWidth: 480, onResize, onReset: vi.fn() });
  const down = (pointerId: number) => handle.props.onPointerDown({ button: 0, pointerId, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
  const sign = edge === 'right' ? 1 : -1;
  down(1);
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 + sign * 40, buttons: 1 });
  expect(width).toBe(320);
  handle.props.onPointerCancel({ pointerId: 2 });
  expect(width).toBe(320);
  expect(classes.has('resizing')).toBe(true);
  handle.props.onPointerCancel({ pointerId: 1 });
  expect(width).toBe(280);
  expect(classes.has('resizing')).toBe(false);
  expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  handle.props.onPointerMove({ pointerId: 1, clientX: 100 + sign * 60, buttons: 1 });
  handle.props.onPointerUp({ pointerId: 1, clientX: 100 + sign * 60 });
  expect(width).toBe(280);
  down(3);
  handle.props.onPointerUp({ pointerId: 3, clientX: 100 + sign * 20 });
  expect(width).toBe(300);
  expect(classes.has('resizing')).toBe(false);
});

it('requires fresh Enter to reset panel width while retaining held-arrow resizing', () => {
  const onReset = vi.fn();
  const onResize = vi.fn();
  const handle = ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 280,
    minWidth: 180, maxWidth: 480, onResize, onReset });
  const press = (key: string, repeat: boolean) => {
    const event = { key, repeat, nativeEvent: {}, preventDefault: vi.fn() };
    handle.props.onKeyDown(event);
    return event;
  };
  expect(press('Enter', false).preventDefault).toHaveBeenCalledOnce();
  expect(onReset).toHaveBeenCalledOnce();
  expect(press('Enter', true).preventDefault).toHaveBeenCalledOnce();
  expect(onReset).toHaveBeenCalledOnce();
  expect(press('ArrowRight', true).preventDefault).toHaveBeenCalledOnce();
  expect(onResize).toHaveBeenCalledExactlyOnceWith(296);
  press('Enter', false);
  expect(onReset).toHaveBeenCalledTimes(2);
});

it('restores a cancelled panel width even when the native pointer expires during capture release', () => {
  const classes = new Set<string>();
  vi.stubGlobal('document', { body: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
  } } });
  let width = 280;
  const onResize = vi.fn((next: number) => { width = next; });
  const target = {
    focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true,
    releasePointerCapture: vi.fn().mockImplementationOnce(() => { throw new DOMException('Pointer inactive', 'NotFoundError'); }),
  };
  const handle = ResizeHandle({ label: 'Panel width', edge: 'right', measure: () => width,
    onResize, onReset: vi.fn() });
  const down = (pointerId: number) => handle.props.onPointerDown({ button: 0, pointerId, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
  down(1);
  handle.props.onPointerMove({ pointerId: 1, clientX: 140, buttons: 1 });
  expect(width).toBe(320);
  expect(() => handle.props.onPointerCancel({ pointerId: 1 })).not.toThrow();
  expect(width).toBe(280);
  expect(classes.has('resizing')).toBe(false);
  handle.props.onPointerUp({ pointerId: 1, clientX: 180 });
  expect(width).toBe(280);
  down(2);
  handle.props.onPointerUp({ pointerId: 2, clientX: 120 });
  expect(width).toBe(300);
  expect(classes.has('resizing')).toBe(false);
});


it('cancels a resize before Escape can dismiss an enclosing dialog and releases the listener on unmount', () => {
  const listeners: Array<{ handler: (event: KeyboardEvent) => void; capture: boolean }> = [];
  const removeEventListener = vi.fn();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: (event: KeyboardEvent) => void, capture = false) => {
      if (name === 'keydown') listeners.push({ handler, capture });
    },
    removeEventListener,
  });
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  let width = 280;
  const handle = ResizeHandle({ label: 'Panel width', edge: 'right', measure: () => width,
    onResize: (next) => { width = next; }, onReset: vi.fn() });
  const cleanups = lifecycle.effects.map(effect => effect());
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const closeDialog = vi.fn();
  const dispatchEscape = () => {
    const event = new Event('keydown', { cancelable: true }) as KeyboardEvent;
    Object.defineProperty(event, 'key', { value: 'Escape' });
    listeners.filter(item => item.capture).forEach(item => item.handler(event));
    // Document-level dialog handlers run between window capture and bubble.
    if (!event.cancelBubble && !event.defaultPrevented) closeDialog();
    if (!event.cancelBubble) listeners.filter(item => !item.capture).forEach(item => item.handler(event));
    return event;
  };
  try {
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
    handle.props.onPointerMove({ pointerId: 1, clientX: 140, buttons: 1 });
    expect(width).toBe(320);
    const event = dispatchEscape();
    expect(closeDialog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(event.cancelBubble).toBe(true);
    expect(width).toBe(280);
    dispatchEscape();
    expect(closeDialog).toHaveBeenCalledOnce();
  } finally { cleanups.forEach(cleanup => cleanup?.()); }
  expect(removeEventListener).toHaveBeenCalledWith('keydown', listeners[0].handler, true);
});
