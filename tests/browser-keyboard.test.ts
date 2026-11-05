import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ setAddress: vi.fn(), address: undefined as string | undefined, hook: 0, addressError: '', setAddressError: vi.fn(), error: '', setError: vi.fn(), requestRef: { current: 0 }, addressRef: { current: null as any } }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'browser-external-error',
  useState: (value: unknown) => {
    const hook = state.hook++ % 3;
    return hook === 1 ? [state.error, state.setError] : hook === 2 ? [state.addressError, state.setAddressError] : [state.address ?? value, state.setAddress];
  },
  useEffect: vi.fn(),
  useRef: (value: unknown) => value === 0 ? state.requestRef : state.addressRef,
}));
vi.mock('../src/lib/desktop', () => ({ isDesktop: () => true, openExternal: vi.fn() }));
import { openExternal } from '../src/lib/desktop';
import { BrowserTab } from '../src/components/BrowserTab';

it('keeps IME confirmation in the browser address bar and navigates on a fresh Enter', () => {
  const onChange = vi.fn();
  const view = BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange,
    onOpenSideChat: vi.fn(),
  });
  const address = view.props.children[0].props.children.find((child: any) => child.type === 'input');
  for (const nativeEvent of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    address.props.onKeyDown({ key: 'Enter', nativeEvent, preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
  }
  address.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() });
  expect(onChange).toHaveBeenCalledOnce();
});

it('cancels an address edit with Escape without navigating or dismissing the surrounding UI', () => {
  for (const url of ['https://example.com/current', null]) {
    state.setAddress.mockClear();
    const onChange = vi.fn();
    const view = BrowserTab({
      state: { history: url ? [url] : [], index: url ? 0 : -1, reloadKey: 0 },
      onChange, onOpenSideChat: vi.fn(),
    });
    const address = view.props.children[0].props.children.find((child: any) => child.type === 'input');
    address.props.onChange({ target: { value: 'unfinished edit' } });
    state.setAddress.mockClear();
    for (const nativeEvent of [{ isComposing: true, keyCode: 27 }, { isComposing: false, keyCode: 229 }]) {
      address.props.onKeyDown({ key: 'Escape', nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(state.setAddress).not.toHaveBeenCalled();
    }
    const event = { key: 'Escape', nativeEvent: { isComposing: false, keyCode: 27 }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    address.props.onKeyDown(event);
    expect(state.setAddress).toHaveBeenCalledExactlyOnceWith(url ?? '');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  }
});

it('gives the browser address field a persistent accessible name on new and loaded tabs', () => {
  for (const url of [null, 'https://example.com/']) {
    const view = BrowserTab({
      state: { history: url ? [url] : [], index: url ? 0 : -1, reloadKey: 0 },
      onChange: vi.fn(), onOpenSideChat: vi.fn(),
    });
    const address = view.props.children[0].props.children.find((child: any) => child.type === 'input');
    expect(address.props['aria-label']).toBe('Search or enter a URL');
  }
});

it('navigates once per fresh address-bar Enter rather than repeating while the key is held', () => {
  const onChange = vi.fn();
  const view = BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  const address = view.props.children[0].props.children.find((child: any) => child.type === 'input');
  const press = (repeat: boolean) => address.props.onKeyDown({
    key: 'Enter', repeat, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn(),
  });
  press(false);
  expect(onChange).toHaveBeenCalledOnce();
  press(true);
  press(true);
  expect(onChange).toHaveBeenCalledOnce();
  press(false);
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('navigates browser history with Alt+Left/Right from the toolbar without consuming unavailable or owned keys', () => {
  const history = ['https://example.com/first', 'https://example.com/second', 'https://example.com/third'];
  for (const [key, index, destination] of [['ArrowLeft', 1, 0], ['ArrowRight', 1, 2]] as const) {
    const onChange = vi.fn();
    const toolbar = BrowserTab({ state: { history, index, reloadKey: 0 }, onChange, onOpenSideChat: vi.fn() }).props.children[0];
    const press = (extra = {}) => {
      const event = { key, altKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
      toolbar.props.onKeyDown?.(event);
      return event;
    };
    for (const extra of [{ defaultPrevented: true }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: false }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
      expect(press(extra).preventDefault).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
    const event = press();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ index: destination, history }));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  }
  for (const [key, index] of [['ArrowLeft', -1], ['ArrowRight', 2]] as const) {
    const onChange = vi.fn();
    const toolbar = BrowserTab({ state: { history, index, reloadKey: 0 }, onChange, onOpenSideChat: vi.fn() }).props.children[0];
    const event = { key, altKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    toolbar.props.onKeyDown?.(event);
    expect(onChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
});

it('reloads a loaded browser tab with standard toolbar shortcuts and discloses them', () => {
  for (const shortcut of [{ key: 'r', metaKey: true }, { key: 'r', ctrlKey: true }, { key: 'F5' }]) {
    const onChange = vi.fn();
    const toolbar = BrowserTab({ state: { history: ['https://example.com/'], index: 0, reloadKey: 2 }, onChange, onOpenSideChat: vi.fn() }).props.children[0];
    const press = (extra = {}) => {
      const event = { ...shortcut, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
      toolbar.props.onKeyDown(event);
      return event;
    };
    for (const extra of [{ defaultPrevented: true }, { repeat: true }, { altKey: true }, { shiftKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
      expect(press(extra).preventDefault).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
    const event = press();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ history: ['https://example.com/'], index: 0, reloadKey: 3 });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    const reload = toolbar.props.children.find((child: any) => child.props?.title?.startsWith('Reload'));
    expect(reload.props['aria-keyshortcuts']).toBe('Meta+R Control+R F5');
    const emptyChange = vi.fn();
    const empty = BrowserTab({ state: { history: [], index: -1, reloadKey: 0 }, onChange: emptyChange, onOpenSideChat: vi.fn() }).props.children[0];
    const idle = { ...shortcut, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    empty.props.onKeyDown(idle);
    expect(emptyChange).not.toHaveBeenCalled();
    expect(idle.preventDefault).not.toHaveBeenCalled();
  }
});

it('focuses the address field with Cmd/Ctrl+L from browser toolbar controls', () => {
  for (const url of [null, 'https://example.com/']) {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const onChange = vi.fn();
      const toolbar = BrowserTab({ state: { history: url ? [url] : [], index: url ? 0 : -1, reloadKey: 0 }, onChange, onOpenSideChat: vi.fn() }).props.children[0];
      const address = toolbar.props.children.find((child: any) => child.type === 'input');
      const focus = vi.fn();
      state.addressRef.current = { focus, select: vi.fn() };
      const press = (extra = {}) => {
        const event = { key: 'l', ...modifier, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
        toolbar.props.onKeyDown(event);
        return event;
      };
      for (const extra of [{ defaultPrevented: true }, { repeat: true }, { altKey: true }, { shiftKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
        expect(press(extra).preventDefault).not.toHaveBeenCalled();
        expect(focus).not.toHaveBeenCalled();
      }
      const event = press();
      expect(focus).toHaveBeenCalledOnce();
      expect(address.ref).toBe(state.addressRef);
      expect(address.props['aria-keyshortcuts']).toBe('Meta+L Control+L');
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
      state.addressRef.current = null;
    }
  }
});

it('selects the address with Cmd/Ctrl+L even when the field already has focus', () => {
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    const onChange = vi.fn();
    const toolbar = BrowserTab({
      state: { history: ['https://example.com/current'], index: 0, reloadKey: 0 },
      onChange, onOpenSideChat: vi.fn(),
    }).props.children[0];
    // Focusing an already-focused DOM input does not emit another focus event.
    const focus = vi.fn();
    const select = vi.fn();
    state.addressRef.current = { focus, select };
    try {
      toolbar.props.onKeyDown({ key: 'l', ...modifier, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(focus).toHaveBeenCalledOnce();
      expect(select).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
    } finally { state.addressRef.current = null; }
  }
});

it('leaves already-consumed address keys alone without navigating or discarding an edit', () => {
  state.setAddress.mockClear();
  const onChange = vi.fn();
  const toolbar = BrowserTab({
    state: { history: ['https://example.com/current'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  }).props.children[0];
  const address = toolbar.props.children.find((child: any) => child.type === 'input');
  address.props.onChange({ target: { value: 'unfinished address' } });
  state.setAddress.mockClear();
  for (const key of ['Enter', 'Escape']) {
    const event = { key, defaultPrevented: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    address.props.onKeyDown(event);
    expect(onChange, key).not.toHaveBeenCalled();
    expect(state.setAddress, key).not.toHaveBeenCalled();
    expect(event.preventDefault, key).not.toHaveBeenCalled();
    expect(event.stopPropagation, key).not.toHaveBeenCalled();
  }
});


it('routes external browser failure feedback to an accessible alert and clears it on retry', async () => {
  state.setError.mockImplementation((message: string) => { state.error = message; });
  vi.mocked(openExternal).mockImplementation(async (_url, notify) => {
    notify?.('Could not open in your browser. Try again.');
  });
  const render = () => BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange: vi.fn(), onOpenSideChat: vi.fn(),
  });
  const launch = render().props.children[0].props.children.find((child: any) => child.props?.title === 'Open in system browser');
  try {
    await launch.props.onClick();
    const alert = render().props.children.flat().find((child: any) => child?.props?.role === 'alert');
    expect(alert?.props.children).toBe('Could not open in your browser. Try again.');
    vi.mocked(openExternal).mockResolvedValue(undefined);
    state.setError.mockClear();
    await launch.props.onClick();
    expect(state.setError).toHaveBeenCalledExactlyOnceWith('');
    expect(render().props.children.flat().some((child: any) => child?.props?.role === 'alert')).toBe(false);
  } finally { state.error = ''; }
});

it('dismisses external browser failure feedback without relaunching or changing the page', () => {
  state.error = 'Could not open in your browser. Try again.';
  state.setError.mockImplementation((message: string) => { state.error = message; });
  vi.mocked(openExternal).mockClear();
  const onChange = vi.fn();
  const render = () => BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  try {
    const view = render();
    const dismiss = view.props.children.flat().find((child: any) => child?.props?.['aria-label'] === 'Dismiss browser error');
    expect(dismiss).toBeDefined();
    dismiss.props.onClick();
    expect(render().props.children.flat().some((child: any) => child?.props?.role === 'alert')).toBe(false);
    expect(render().props.children.flat().some((child: any) => child?.props?.['aria-label'] === 'Dismiss browser error')).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  } finally { state.error = ''; }
});

it('clears external launch feedback when navigation changes the current page', async () => {
  const { useEffect } = await import('react');
  state.setError.mockImplementation((message: string) => { state.error = message; });
  state.error = 'Could not open in your browser. Try again.';
  state.setError.mockClear();
  vi.mocked(useEffect).mockClear();
  const onChange = vi.fn();
  try {
    BrowserTab({
      state: { history: ['https://example.com/old', 'https://example.com/new'], index: 1, reloadKey: 0 },
      onChange, onOpenSideChat: vi.fn(),
    });
    // Run the effects React schedules for the newly committed URL.
    for (const [effect, dependencies] of vi.mocked(useEffect).mock.calls) {
      if (dependencies?.includes('https://example.com/new')) effect();
    }
    expect(state.setAddress).toHaveBeenCalledWith('https://example.com/new');
    expect(state.setError).toHaveBeenCalledWith('');
    expect(state.error).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  } finally { state.error = ''; }
});


it('ignores a pending external-launch failure after navigation, dismissal, or unmount', async () => {
  const { useEffect } = await import('react');
  for (const interruption of ['navigation', 'dismissal', 'unmount']) {
    state.error = '';
    state.setError.mockImplementation((message: string) => { state.error = message; });
    vi.mocked(useEffect).mockClear();
    let notify: ((message: string) => void) | undefined;
    vi.mocked(openExternal).mockImplementation(async (_url, callback) => { notify = callback; });
    const render = (url = 'https://example.com/old') => BrowserTab({
      state: { history: [url], index: 0, reloadKey: 0 }, onChange: vi.fn(), onOpenSideChat: vi.fn(),
    });
    const view = render();
    const cleanup = vi.mocked(useEffect).mock.calls[0][0]();
    await view.props.children[0].props.children.find((child: any) => child.props?.title === 'Open in system browser').props.onClick();
    expect(notify).toBeTypeOf('function');
    if (interruption === 'navigation') {
      vi.mocked(useEffect).mockClear();
      render('https://example.com/new');
      vi.mocked(useEffect).mock.calls[0][0]();
    } else if (interruption === 'dismissal') {
      notify?.('Launch failed');
      render().props.children.flat().find((child: any) => child?.props?.['aria-label'] === 'Dismiss browser error').props.onClick();
    } else {
      if (typeof cleanup === 'function') cleanup();
    }
    state.setError.mockClear();
    notify?.('Late launch failure');
    expect(state.setError, interruption).not.toHaveBeenCalled();
  }
  state.error = '';
});


it('returns keyboard focus to the address field when dismissing a browser error', () => {
  state.error = 'Could not open in your browser. Try again.';
  const focus = vi.fn();
  state.addressRef.current = { focus };
  const onChange = vi.fn();
  vi.mocked(openExternal).mockClear();
  try {
    const view = BrowserTab({
      state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
      onChange, onOpenSideChat: vi.fn(),
    });
    const dismiss = view.props.children.flat().find((child: any) => child?.props?.['aria-label'] === 'Dismiss browser error');
    dismiss.props.onClick();
    expect(focus).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  } finally {
    state.error = '';
    state.addressRef.current = null;
  }
});

it('associates external-launch failure with its retry control until recovery', async () => {
  state.error = 'Could not open in your browser. Try again.';
  state.setError.mockImplementation((message: string) => { state.error = message; });
  vi.mocked(openExternal).mockResolvedValue(undefined);
  const render = () => BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange: vi.fn(), onOpenSideChat: vi.fn(),
  });
  const launch = (view: any) => view.props.children[0].props.children.find((child: any) => child.props?.title === 'Open in system browser');
  try {
    const failed = render();
    const alert = failed.props.children.flat().find((child: any) => child?.props?.role === 'alert');
    expect(alert.props.id).toBeTruthy();
    expect(launch(failed).props['aria-describedby']).toBe(alert.props.id);
    await launch(failed).props.onClick();
    const recovered = render();
    expect(launch(recovered).props['aria-describedby']).toBeUndefined();
    expect(recovered.props.children.flat().some((child: any) => child?.props?.role === 'alert')).toBe(false);
  } finally { state.error = ''; }
});


it('explains rejected addresses and clears validation feedback on correction or Escape', () => {
  state.setAddressError.mockImplementation((message: string) => { state.addressError = message; });
  state.address = 'file:///private/document';
  const onChange = vi.fn();
  const render = () => BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  const input = (view: any) => view.props.children[0].props.children.find((child: any) => child.type === 'input');
  try {
    const initial = render();
    input(initial).props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
    const failed = render();
    const alert = failed.props.children.flat().find((child: any) => child?.props?.role === 'alert');
    expect(alert?.props.children).toBe('Enter a valid http:// or https:// address, or a search term.');
    expect(input(failed).props['aria-invalid']).toBe(true);
    expect(input(failed).props['aria-describedby']).toBe(alert.props.id);
    expect(input(failed).props.value).toBe('file:///private/document');
    input(failed).props.onChange({ target: { value: 'https://example.com/' } });
    expect(input(render()).props['aria-invalid']).toBeUndefined();
    state.addressError = 'Invalid address';
    input(render()).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(input(render()).props['aria-describedby']).toBeUndefined();
  } finally { state.addressError = ''; state.address = undefined; }
});

it('explains blank address submissions and lets correction navigate without stale feedback', () => {
  state.setAddressError.mockImplementation((message: string) => { state.addressError = message; });
  const onChange = vi.fn();
  const render = () => BrowserTab({
    state: { history: [], index: -1, reloadKey: 0 }, onChange, onOpenSideChat: vi.fn(),
  });
  const input = (view: any) => view.props.children[0].props.children.find((child: any) => child.type === 'input');
  try {
    for (const blank of ['', '   ']) {
      state.address = blank;
      input(render()).props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
      const failed = render();
      const alert = failed.props.children.flat().find((child: any) => child?.props?.role === 'alert');
      expect(alert?.props.children).toBe('Enter an address or search term.');
      expect(input(failed).props['aria-invalid']).toBe(true);
      expect(input(failed).props['aria-describedby']).toBe(alert.props.id);
      expect(input(failed).props.value).toBe(blank);
      expect(onChange).not.toHaveBeenCalled();
      input(failed).props.onChange({ target: { value: 'https://example.com/' } });
      expect(input(render()).props['aria-invalid']).toBeUndefined();
      expect(input(render()).props['aria-describedby']).toBeUndefined();
    }
    state.address = 'https://example.com/';
    input(render()).props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ history: ['https://example.com/'], index: 0 }));
    expect(render().props.children.flat().some((child: any) => child?.props?.role === 'alert')).toBe(false);
  } finally { state.addressError = ''; state.address = undefined; }
});

it('preserves an unfinished address and validation feedback on modified Escape until plain Escape cancels', () => {
  state.address = 'file:///unfinished';
  state.addressError = 'Enter a valid http:// or https:// address, or a search term.';
  state.setAddress.mockClear();
  state.setAddressError.mockClear();
  const onChange = vi.fn();
  try {
    const view = BrowserTab({
      state: { history: ['https://example.com/current'], index: 0, reloadKey: 0 },
      onChange, onOpenSideChat: vi.fn(),
    });
    const input = view.props.children[0].props.children.find((child: any) => child.type === 'input');
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      const event = { key: 'Escape', ...modifier, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      input.props.onKeyDown(event);
      expect(state.setAddress).not.toHaveBeenCalled();
      expect(state.setAddressError).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    const cancel = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    input.props.onKeyDown(cancel);
    expect(state.setAddress).toHaveBeenCalledExactlyOnceWith('https://example.com/current');
    expect(state.setAddressError).toHaveBeenCalledExactlyOnceWith('');
    expect(cancel.preventDefault).toHaveBeenCalledOnce();
    expect(cancel.stopPropagation).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  } finally { state.address = undefined; state.addressError = ''; }
});

it('retains the address and reports safe feedback when navigation fails, then permits retry', () => {
  state.address = 'https://example.com/new';
  state.setAddress.mockClear();
  state.setAddressError.mockClear();
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
  const render = () => BrowserTab({
    state: { history: ['https://example.com/current'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  const input = render().props.children[0].props.children.find((child: any) => child.type === 'input');
  const press = () => input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(press).not.toThrow();
  expect(state.setAddress).not.toHaveBeenCalled();
  expect(state.setAddressError).toHaveBeenLastCalledWith('Could not navigate. Your address is still here. Try again.');
  state.addressError = state.setAddressError.mock.lastCall![0];
  const failed = render();
  const failedInput = failed.props.children[0].props.children.find((child: any) => child.type === 'input');
  const alert = failed.props.children.find((child: any) => child?.props?.id === failedInput.props['aria-describedby']);
  expect(failedInput.props['aria-invalid']).toBe(true);
  expect(alert.props.role).toBe('alert');
  expect(alert.props.children).not.toContain('private storage');
  press();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ history: ['https://example.com/current', 'https://example.com/new'] }));
  expect(state.setAddressError).toHaveBeenLastCalledWith('');
  state.address = undefined;
  state.addressError = '';
});

it('retains a failed suggested-site destination in the address field and focuses it for Enter retry', () => {
  state.address = '';
  state.addressError = '';
  state.setAddress.mockImplementation((value: string) => { state.address = value; });
  state.setAddressError.mockImplementation((value: string) => { state.addressError = value; });
  const focus = vi.fn();
  state.addressRef.current = { focus };
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
  const render = () => BrowserTab({
    state: { history: [], index: -1, reloadKey: 0 }, onChange, onOpenSideChat: vi.fn(),
  });
  try {
    const view = render();
    const suggested = view.props.children[4].props.children[1].props.children[1].props.children[0];
    expect(() => suggested.props.onClick()).not.toThrow();
    const failed = render();
    const input = failed.props.children[0].props.children.find((child: any) => child.type === 'input');
    expect(input.props.value).toBe('https://www.google.com/');
    expect(focus).toHaveBeenCalledOnce();
    const alert = failed.props.children.find((child: any) => child?.props?.id === input.props['aria-describedby']);
    expect(alert.props.role).toBe('alert');
    expect(alert.props.children).toBe('Could not navigate. Your address is still here. Try again.');
    input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ history: ['https://www.google.com/'], index: 0 }));
    expect(state.addressError).toBe('');
  } finally {
    state.address = undefined;
    state.addressError = '';
    state.addressRef.current = null;
    state.setAddress.mockReset();
  }
});

it('reports history and reload update failures safely and allows the same control to retry', () => {
  state.setError.mockImplementation((message: string) => { state.error = message; });
  const browserState = { history: ['https://example.com/first', 'https://example.com/current', 'https://example.com/next'], index: 1, reloadKey: 0 };
  try {
    for (const title of ['Back', 'Forward', 'Reload']) {
      for (const keyboard of [false, true]) {
        state.error = '';
        const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
        const render = () => BrowserTab({ state: browserState, onChange, onOpenSideChat: vi.fn() });
        const control = (view: any) => view.props.children[0].props.children.find((child: any) => child.props?.title?.startsWith(title));
        const activate = () => {
          const view = render();
          if (!keyboard) return control(view).props.onClick();
          view.props.children[0].props.onKeyDown({
            key: title === 'Back' ? 'ArrowLeft' : title === 'Forward' ? 'ArrowRight' : 'F5',
            altKey: title !== 'Reload', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
          });
        };
        expect(activate).not.toThrow();
        const failed = render();
        const alert = failed.props.children.flat().find((child: any) => child?.props?.role === 'alert');
        expect(alert?.props.children).toBe('Could not update the page. Try the browser control again.');
        expect(control(failed).props['aria-describedby']).toBe(alert.props.id);
        expect(browserState.index).toBe(1);
        activate();
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onChange.mock.calls[1][0]).toEqual(onChange.mock.calls[0][0]);
        expect(state.error).toBe('');
        expect(control(render()).props['aria-describedby']).toBeUndefined();
      }
    }
  } finally { state.error = ''; }
});

it('reports page-originated navigation persistence failures and recovers on a fresh navigation event', () => {
  state.setError.mockImplementation((message: string) => { state.error = message; });
  const browserState = { history: ['https://example.com/current'], index: 0, reloadKey: 0 };
  try {
    for (const redirect of [false, true]) {
      state.error = '';
      const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
      const render = () => BrowserTab({ state: browserState, onChange, onOpenSideChat: vi.fn() });
      const page = (view: any) => view.props.children.find((child: any) => child?.props?.className === 'browser-viewport').props.children;
      const request = state.requestRef.current;
      expect(() => page(render()).props.onNavigate('https://example.com/landed', redirect)).not.toThrow();
      expect(state.requestRef.current).toBeGreaterThan(request);
      const failed = render();
      const alert = failed.props.children.flat().find((child: any) => child?.props?.role === 'alert');
      expect(alert?.props.children).toBe('Could not update the page. Try the browser control again.');
      expect(browserState.history).toEqual(['https://example.com/current']);
      page(failed).props.onNavigate('https://example.com/landed', redirect);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange.mock.calls[1][0]).toEqual(onChange.mock.calls[0][0]);
      expect(onChange.mock.calls[1][0].history).toEqual(redirect
        ? ['https://example.com/landed'] : ['https://example.com/current', 'https://example.com/landed']);
      expect(state.error).toBe('');
    }
  } finally { state.error = ''; }
});

it('reloads a resubmitted current address without duplicating or discarding browser history', () => {
  const browserState = {
    history: ['https://example.com/previous', 'https://example.com/', 'https://example.com/next'],
    index: 1, reloadKey: 4,
  };
  const onChange = vi.fn();
  try {
    // Normalize the edited address before deciding whether it needs navigation.
    state.address = '  https://example.com  ';
    const view = BrowserTab({ state: browserState, onChange, onOpenSideChat: vi.fn() });
    const input = view.props.children[0].props.children.find((child: any) => child.type === 'input');
    input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...browserState, reloadKey: 5 });
    expect(browserState.history).toHaveLength(3);
    expect(browserState.reloadKey).toBe(4);
  } finally { state.address = undefined; }
});

it('clears browser failure feedback and fences pending external launches on address-bar reload', async () => {
  state.setError.mockImplementation((message: string) => { state.error = message; });
  let notify: ((message: string) => void) | undefined;
  vi.mocked(openExternal).mockImplementation(async (_url, callback) => { notify = callback; });
  const browserState = { history: ['https://example.com/'], index: 0, reloadKey: 0 };
  const onChange = vi.fn();
  const render = () => BrowserTab({ state: browserState, onChange, onOpenSideChat: vi.fn() });
  try {
    state.address = 'https://example.com/';
    state.error = '';
    const toolbar = render().props.children[0];
    await toolbar.props.children.find((child: any) => child.props?.title === 'Open in system browser').props.onClick();
    expect(notify).toBeTypeOf('function');
    notify?.('Could not open in your browser. Try again.');
    expect(state.error).not.toBe('');
    const input = render().props.children[0].props.children.find((child: any) => child.type === 'input');
    input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...browserState, reloadKey: 1 });
    expect(state.error).toBe('');
    state.setError.mockClear();
    notify?.('Late launch failure');
    expect(state.setError).not.toHaveBeenCalled();
  } finally { state.address = undefined; state.error = ''; }
});

it('preserves the address draft for modified Enter and navigates on plain Enter', () => {
  const onChange = vi.fn();
  const view = BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  const input = view.props.children[0].props.children.find((child: any) => child.type === 'input');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    input.props.onKeyDown({ key: 'Enter', [modifier]: true, nativeEvent: {}, preventDefault: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
  }
  input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(onChange).toHaveBeenCalledOnce();
});

it('preserves the address correction selection when failed navigation restores focus', () => {
  state.address = 'https://example.com/correction';
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  const view = BrowserTab({
    state: { history: ['https://example.com/'], index: 0, reloadKey: 0 },
    onChange, onOpenSideChat: vi.fn(),
  });
  const input = view.props.children[0].props.children.find((child: any) => child.type === 'input');
  const target = {
    selectionStart: 20, selectionEnd: 24, selectionDirection: 'backward',
    select: vi.fn(() => { target.selectionStart = 0; target.selectionEnd = state.address!.length; }),
    focus: vi.fn(() => input.props.onFocus({ target })),
    setSelectionRange: vi.fn((start: number, end: number, direction: string) => {
      target.selectionStart = start; target.selectionEnd = end; target.selectionDirection = direction;
    }),
  };
  state.addressRef.current = target;
  try {
    input.props.onKeyDown({ key: 'Enter', nativeEvent: {} });
    expect(target.focus).toHaveBeenCalledOnce();
    expect([target.selectionStart, target.selectionEnd, target.selectionDirection]).toEqual([20, 24, 'backward']);
    input.props.onKeyDown({ key: 'Enter', nativeEvent: {} });
    expect(onChange).toHaveBeenCalledTimes(2);
    // Ordinary focus still selects the complete address for replacement.
    input.props.onFocus({ target });
    expect([target.selectionStart, target.selectionEnd]).toEqual([0, state.address.length]);
  } finally { state.address = undefined; state.addressRef.current = null; }
});
