import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useLayoutEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));
import { useDialog } from '../src/components/useDialog';

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
});

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.unstubAllGlobals();
});

it.each([
  { isComposing: true, keyCode: 27 },
  { isComposing: false, keyCode: 229 },
])('lets IME consume Escape ($isComposing/$keyCode) before ordinary Escape dismisses the dialog', (composition) => {
  const listeners = new Map<string, (event: any) => void>();
  const dialog = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const onClose = vi.fn();
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], onClose);
  const cleanup = lifecycle.effects[0]();
  try {
    const composingEscape = { key: 'Escape', ...composition, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(composingEscape);
    expect(onClose).not.toHaveBeenCalled();
    expect(composingEscape.preventDefault).not.toHaveBeenCalled();
    const escape = { ...composingEscape, isComposing: false, keyCode: 27 };
    listeners.get('keydown')!(escape);
    expect(onClose).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
});

it('returns reverse Tab from outside the dialog to its last control', () => {
  const listeners = new Map<string, (event: any) => void>();
  const outside = {};
  const first = { tabIndex: 0, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null };
  const last = { tabIndex: 0, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null };
  const dialog = { contains: (target: unknown) => target !== outside,
    querySelectorAll: () => [first, last], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', {
    activeElement: outside,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    first.focus.mockClear();
    const tab = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();
    listeners.get('keydown')!({ ...tab, shiftKey: false });
    expect(first.focus).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
});

it('wraps Tab around sequential controls without focusing arrow-navigated options', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = (tabIndex: number) => ({ tabIndex, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null });
  const input = control(0);
  const close = control(0);
  const option = control(-1);
  const doc = {
    activeElement: close,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dialog = { contains: () => true, querySelectorAll: () => [input, close, option], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', doc);
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(input.focus).toHaveBeenCalledOnce();
    doc.activeElement = input;
    listeners.get('keydown')!({ ...tab, shiftKey: true });
    expect(close.focus).toHaveBeenCalledOnce();
    expect(option.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});

it('does not restore an underlying dialog opener while a top dialog remains open', () => {
  class Element {
    isConnected = true;
    getClientRects = () => [1];
    matches = () => false;
    closest = () => null;
    focus = vi.fn();
  }
  const outside = new Element();
  const lowerControl = new Element();
  const upperControl = new Element();
  const doc = {
    activeElement: outside,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const dialog = () => ({ contains: () => true, querySelectorAll: () => [], focus: vi.fn() });
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: dialog() } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = lowerControl;
  useDialog({ current: dialog() } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  doc.activeElement = upperControl;
  try {
    if (cleanupLower) cleanupLower();
    expect(outside.focus).not.toHaveBeenCalled();
    expect(upperControl.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanupUpper) cleanupUpper();
  }
  expect(lowerControl.focus).toHaveBeenCalledOnce();
});


it('excludes controls disabled by a fieldset from dialog Tab wrapping', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = (disabled: boolean) => ({
    tabIndex: 0, focus: vi.fn(), getClientRects: () => [1], closest: () => null,
    matches: (selector: string) => selector === ':disabled' && disabled,
  });
  const first = control(false);
  const last = control(false);
  const disabledFieldsetInput = control(true);
  const doc = {
    activeElement: last,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dialog = { contains: () => true, querySelectorAll: () => [first, last, disabledFieldsetInput], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', doc);
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    doc.activeElement = first;
    listeners.get('keydown')!({ ...tab, shiftKey: true });
    expect(last.focus).toHaveBeenCalledOnce();
    expect(disabledFieldsetInput.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});

it('ignores held Escape repeats so a fresh press is required to dismiss a modal', () => {
  const listeners = new Map<string, (event: any) => void>();
  const dialog = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const onClose = vi.fn();
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], onClose);
  const cleanup = lifecycle.effects[0]();
  try {
    const heldEscape = { key: 'Escape', repeat: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(heldEscape);
    expect(onClose).not.toHaveBeenCalled();
    listeners.get('keydown')!({ ...heldEscape, repeat: false });
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
});

it('recovers focus in the remaining modal when a nested dialog opener was removed', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    focus = vi.fn();
    matches = () => false;
    getClientRects = () => [1];
    closest = () => null;
  }
  const outside = new Element();
  const removedOpener = new Element();
  const remainingControl = new Element();
  const lower = { contains: () => true, querySelectorAll: () => [remainingControl], focus: vi.fn() };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = removedOpener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  removedOpener.isConnected = false;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(removedOpener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
    expect(outside.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanupLower) cleanupLower();
  }
});

it('recovers focus in the remaining modal when its connected opener becomes disabled', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    focus = vi.fn();
    disabled = false;
    matches = (selector: string) => selector === ':disabled' && this.disabled;
    getClientRects = () => [1];
    closest = () => null;
  }
  const outside = new Element();
  const disabledOpener = new Element();
  const remainingControl = new Element();
  const lower = { contains: () => true, querySelectorAll: () => [remainingControl], focus: vi.fn() };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = disabledOpener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  disabledOpener.disabled = true;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(disabledOpener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
    expect(outside.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanupLower) cleanupLower();
  }
});


it('recovers focus in the remaining modal when its opener becomes inert', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    inert = false;
    focus = vi.fn();
    matches = () => false;
    getClientRects = () => [1];
    closest = () => this.inert ? {} : null;
  }
  const outside = new Element();
  const opener = new Element();
  const remainingControl = new Element();
  const lower = { contains: () => true, querySelectorAll: () => [remainingControl], focus: vi.fn() };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = opener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  opener.inert = true;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(opener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
  } finally {
    if (cleanupLower) cleanupLower();
  }
});


it('recovers focus in the remaining modal when its opener becomes hidden by CSS', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    focus = vi.fn();
    visible = true;
    matches = () => false;
    getClientRects = () => this.visible ? [1] : [];
    closest = () => null;
  }
  const outside = new Element();
  const hiddenOpener = new Element();
  const remainingControl = new Element();
  const lower = { contains: () => true, querySelectorAll: () => [remainingControl], focus: vi.fn() };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = hiddenOpener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  hiddenOpener.visible = false;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(hiddenOpener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
    expect(outside.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanupLower) cleanupLower();
  }
});

it('wraps modal focus past CSS visibility-hidden controls that still occupy layout space', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = (visibility: string) => ({
    visibility, tabIndex: 0, focus: vi.fn(), matches: () => false,
    getClientRects: () => [1], closest: () => null,
  });
  const first = control('visible');
  const last = control('visible');
  const hidden = control('hidden');
  const doc = {
    activeElement: last,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dialog = { contains: () => true, querySelectorAll: () => [hidden, first, last, hidden], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', (element: { visibility: string }) => ({ visibility: element.visibility }));
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    doc.activeElement = first;
    listeners.get('keydown')!({ ...tab, shiftKey: true });
    expect(last.focus).toHaveBeenCalledOnce();
    expect(hidden.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});

it('restores visible modal focus when the nested opener becomes visibility-hidden', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    focus = vi.fn();
    visible = true;
    matches = () => false;
    getClientRects = () => [1];
    closest = () => null;
  }
  const outside = new Element();
  const hiddenOpener = new Element();
  const remainingControl = new Element();
  const lower = { contains: () => true, querySelectorAll: () => [remainingControl], focus: vi.fn() };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', (element: Element) => ({ visibility: element.visible ? 'visible' : 'hidden' }));
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = hiddenOpener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  hiddenOpener.visible = false;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(hiddenOpener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
    expect(outside.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanupLower) cleanupLower();
  }
});

it('keeps Tab inside a modal when an arrow-navigated option owns focus', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = (tabIndex: number) => ({ tabIndex, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null });
  const first = control(0);
  const last = control(0);
  const option = control(-1);
  const doc = {
    activeElement: option,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dialog = { contains: () => true, querySelectorAll: () => [first, last, option], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', doc);
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    const reverse = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };
    listeners.get('keydown')!(reverse);
    expect(reverse.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
    expect(option.focus).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});

it('wraps modal Tab in browser order when positive tabindex controls precede ordinary controls', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = (tabIndex: number) => ({ tabIndex, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null });
  const ordinaryFirst = control(0);
  const prioritySecond = control(2);
  const priorityFirst = control(1);
  const ordinaryLast = control(0);
  const doc = {
    activeElement: ordinaryLast,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dialog = { contains: () => true, querySelectorAll: () => [ordinaryFirst, prioritySecond, priorityFirst, ordinaryLast], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', doc);
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(priorityFirst.focus).toHaveBeenCalledOnce();
    expect(ordinaryFirst.focus).not.toHaveBeenCalled();
    doc.activeElement = priorityFirst;
    const reverse = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };
    listeners.get('keydown')!(reverse);
    expect(reverse.preventDefault).toHaveBeenCalledOnce();
    expect(ordinaryLast.focus).toHaveBeenCalledOnce();
    // Interior navigation belongs to the browser, including equal-priority DOM order.
    doc.activeElement = prioritySecond;
    const interior = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.get('keydown')!(interior);
    expect(interior.preventDefault).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('preserves system and assistive-technology shortcuts while retaining ordinary modal keyboard operation', () => {
  const listeners = new Map<string, (event: any) => void>();
  const control = { tabIndex: 0, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null };
  const dialog = { contains: () => true, querySelectorAll: () => [control], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', {
    activeElement: control,
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const onClose = vi.fn();
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], onClose);
  const cleanup = lifecycle.effects[0]();
  try {
    for (const key of ['Escape', 'Tab']) {
      const modifiers = key === 'Escape' ? ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] : ['altKey', 'ctrlKey', 'metaKey'];
      for (const modifier of modifiers) {
        const event = { key, [modifier]: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        listeners.get('keydown')!(event);
        expect(onClose).not.toHaveBeenCalled();
        expect(control.focus).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      }
    }
    for (const shiftKey of [false, true]) {
      const tab = { key: 'Tab', shiftKey, preventDefault: vi.fn() };
      listeners.get('keydown')!(tab);
      expect(tab.preventDefault).toHaveBeenCalledOnce();
    }
    expect(control.focus).toHaveBeenCalledTimes(2);
    const escape = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')!(escape);
    expect(onClose).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
  } finally {
    if (cleanup) cleanup();
  }
  expect(listeners.size).toBe(0);
});

it('restores focus inside the remaining modal when a nested opener has moved outside it', () => {
  class Element {
    isConnected = true;
    tabIndex = 0;
    focus = vi.fn();
    matches = () => false;
    getClientRects = () => [1];
    closest = () => null;
  }
  const outside = new Element();
  const opener = new Element();
  const remainingControl = new Element();
  let openerInside = true;
  const lower = {
    contains: (target: unknown) => target === remainingControl || (target === opener && openerInside),
    querySelectorAll: () => [remainingControl], focus: vi.fn(),
  };
  const upper = { contains: () => true, querySelectorAll: () => [], focus: vi.fn() };
  const doc = { activeElement: outside, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', doc);
  useDialog({ current: lower } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupLower = lifecycle.effects[0]();
  doc.activeElement = opener;
  useDialog({ current: upper } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanupUpper = lifecycle.effects[1]();
  remainingControl.focus.mockClear();
  openerInside = false;
  try {
    if (cleanupUpper) cleanupUpper();
    expect(opener.focus).not.toHaveBeenCalled();
    expect(remainingControl.focus).toHaveBeenCalledOnce();
  } finally {
    if (cleanupLower) cleanupLower();
  }
  expect(outside.focus).toHaveBeenCalledOnce();
});

it('moves initial modal focus away from a hidden control already inside the dialog', () => {
  class Element {}
  const hidden = Object.assign(new Element(), { tabIndex: 0, focus: vi.fn(), matches: () => false, getClientRects: () => [], closest: () => null });
  const visible = { tabIndex: 0, focus: vi.fn(), matches: () => false, getClientRects: () => [1], closest: () => null };
  const dialog = { contains: () => true, querySelectorAll: () => [hidden, visible], focus: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', {
    activeElement: hidden, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  useDialog({ current: dialog } as unknown as Parameters<typeof useDialog>[0], vi.fn());
  const cleanup = lifecycle.effects[0]();
  try {
    expect(visible.focus).toHaveBeenCalledOnce();
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(dialog.focus).not.toHaveBeenCalled();
  } finally { cleanup?.(); }
});
