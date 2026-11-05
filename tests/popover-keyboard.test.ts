import { afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
  useState: vi.fn(),
}));
import { useDismiss } from '../src/components/useCopy';

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.unstubAllGlobals();
});

it('leaves a popover open for consumed Escape and retains ordinary dismissal', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const inside = {};
  const ref = { current: { contains: (target: unknown) => target === inside } };
  const close = vi.fn();
  useDismiss(true, ref as unknown as Parameters<typeof useDismiss>[1], close);
  const cleanup = lifecycle.effects[0]();
  try {
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', defaultPrevented: true });
    expect(close).not.toHaveBeenCalled();
    listeners.get('keydown')!({ key: 'Enter', defaultPrevented: false });
    listeners.get('mousedown')!({ target: inside });
    expect(close).not.toHaveBeenCalled();
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', defaultPrevented: false });
    expect(close).toHaveBeenCalledOnce();
    listeners.get('mousedown')!({ target: {} });
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('keeps popovers open when Escape cancels IME composition', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const close = vi.fn();
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', isComposing: true, keyCode: 27 });
    expect(close).not.toHaveBeenCalled();
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', isComposing: false, keyCode: 229 });
    expect(close).not.toHaveBeenCalled();
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', isComposing: false, keyCode: 27 });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('keeps a newly opened popover open for held Escape until a fresh keypress', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const close = vi.fn();
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', repeat: true });
    expect(close).not.toHaveBeenCalled();
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', repeat: false });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});


it('dismisses popovers on outside touch while preserving inside touches and removing the listener', () => {
  const listeners = new Map<string, (event: any) => void>();
  const removeEventListener = vi.fn((name: string, handler: (event: any) => void) => {
    if (listeners.get(name) === handler) listeners.delete(name);
  });
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener,
  });
  const inside = {};
  const close = vi.fn();
  useDismiss(true, { current: { contains: (target: unknown) => target === inside } } as unknown as Parameters<typeof useDismiss>[1], close);
  const cleanup = lifecycle.effects[0]();
  try {
    expect(listeners.has('touchstart')).toBe(true);
    listeners.get('touchstart')!({ target: inside });
    expect(close).not.toHaveBeenCalled();
    listeners.get('touchstart')!({ target: {} });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
  expect(listeners.size).toBe(0);
});

it('preserves a popover when another control consumes outside input and still dismisses on a fresh outside press', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const close = vi.fn();
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    for (const name of ['mousedown', 'touchstart']) {
      listeners.get(name)!({ target: {}, defaultPrevented: true });
      expect(close).not.toHaveBeenCalled();
    }
    listeners.get('mousedown')!({ target: {}, defaultPrevented: false });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('preserves an open popover for outside context-menu presses while retaining primary and touch dismissal', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const close = vi.fn();
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    listeners.get('mousedown')!({ target: {}, button: 2 });
    expect(close).not.toHaveBeenCalled();
    listeners.get('mousedown')!({ target: {}, button: 0 });
    expect(close).toHaveBeenCalledOnce();
    listeners.get('touchstart')!({ target: {} });
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('preserves popovers for modified Escape at the document boundary and dismisses for plain Escape', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const close = vi.fn();
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    // Component guards cannot prevent this document listener from seeing bubbling shortcuts.
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape', [modifier]: true };
      listeners.get('keydown')!(event);
      expect(close).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    listeners.get('keydown')!({ preventDefault: vi.fn(), stopPropagation: vi.fn(), key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});


it('consumes a dismissing Escape before later keyboard handlers can act on it', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const event = {
    key: 'Escape', defaultPrevented: false,
    preventDefault: vi.fn(() => { event.defaultPrevented = true; }),
    stopPropagation: vi.fn(),
  };
  const close = vi.fn(() => { expect(event.defaultPrevented).toBe(true); });
  useDismiss(true, { current: null }, close);
  const cleanup = lifecycle.effects[0]();
  try {
    listeners.get('keydown')!(event);
    expect(close).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    // Another listener respecting defaultPrevented must leave this press alone.
    const outerAction = vi.fn();
    if (!event.defaultPrevented) outerAction();
    expect(outerAction).not.toHaveBeenCalled();
  } finally { cleanup?.(); }
  expect(listeners.size).toBe(0);
});
