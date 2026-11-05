import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ refs: [] as any[], cursor: 0, effects: [] as Array<() => any>, states: [] as any[], stateCursor: 0 }));
vi.mock('react', () => ({
  useRef: (current: unknown) => hooks.refs[hooks.cursor++] ?? (hooks.refs[hooks.cursor - 1] = { current }),
  useState: (initial: unknown) => {
    const index = hooks.stateCursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
  useEffect: (effect: () => any) => hooks.effects.push(effect),
}));
import { ChromiumView } from '../src/components/ChromiumView';
afterEach(() => { hooks.refs = []; hooks.cursor = 0; hooks.effects = []; hooks.states = []; hooks.stateCursor = 0; });

it('loads the latest address requested before the embedded browser becomes ready', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (url: string, reloadKey = 0) => {
    hooks.cursor = 0;
    hooks.stateCursor = 0;
    hooks.effects = [];
    return ChromiumView({ url, reloadKey, onNavigate: vi.fn() });
  };
  render('https://initial.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1]();
  hooks.effects[2]();
  try {
    render('https://intermediate.example/');
    hooks.effects[1]();
    render('https://latest.example/', 1);
    hooks.effects[1]();
    hooks.effects[2]();
    expect(webview.loadURL).not.toHaveBeenCalled();
    // The initial document can report navigation before its first dom-ready.
    listeners.get('did-navigate')!({ url: 'https://initial.example/', isMainFrame: true });
    listeners.get('dom-ready')!();
    expect(webview.loadURL).toHaveBeenCalledExactlyOnceWith('https://latest.example/');
    expect(webview.reload).not.toHaveBeenCalled();
    // Subsequent documents also emit dom-ready; they must not replay startup navigation.
    listeners.get('dom-ready')!();
    expect(webview.loadURL).toHaveBeenCalledOnce();
    render('https://ready.example/');
    hooks.effects[1]();
    expect(webview.loadURL).toHaveBeenLastCalledWith('https://ready.example/');
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('does not reload a document when its own navigation is reflected back through browser history', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const onNavigate = vi.fn();
  const render = (url: string) => {
    hooks.cursor = 0;
    hooks.stateCursor = 0;
    hooks.effects = [];
    return ChromiumView({ url, reloadKey: 0, onNavigate });
  };
  render('https://initial.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1]();
  hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    listeners.get('did-navigate')!({ url: 'https://initial.example/', isMainFrame: true });
    onNavigate.mockClear();
    // Both full-document links and same-document routing must preserve page state.
    for (const [event, url] of [
      ['did-navigate', 'https://initial.example/form'],
      ['did-navigate-in-page', 'https://initial.example/form#details'],
    ]) {
      listeners.get(event)!({ url, isMainFrame: true });
      expect(onNavigate).toHaveBeenLastCalledWith(url, false);
      render(url);
      hooks.effects[1]();
      expect(webview.loadURL).not.toHaveBeenCalled();
    }
    render('https://address.example/');
    hooks.effects[1]();
    expect(webview.loadURL).toHaveBeenCalledExactlyOnceWith('https://address.example/');
  } finally { cleanup(); }
});

it('honors reload requested during startup once the embedded browser is ready', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (reloadKey: number) => {
    hooks.cursor = 0;
    hooks.stateCursor = 0;
    hooks.effects = [];
    return ChromiumView({ url: 'https://initial.example/', reloadKey, onNavigate: vi.fn() });
  };
  render(0);
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1]();
  hooks.effects[2]();
  try {
    render(1);
    hooks.effects[2]();
    render(2);
    hooks.effects[2]();
    expect(webview.reload).not.toHaveBeenCalled();
    listeners.get('dom-ready')!();
    expect(webview.reload).toHaveBeenCalledOnce();
    listeners.get('dom-ready')!();
    expect(webview.reload).toHaveBeenCalledOnce();
    render(3);
    hooks.effects[2]();
    expect(webview.reload).toHaveBeenCalledTimes(2);
  } finally { cleanup(); }
});

it('preserves a startup redirect document when history reflects it before readiness', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const onNavigate = vi.fn();
  const render = (url: string) => {
    hooks.cursor = 0;
    hooks.stateCursor = 0;
    hooks.effects = [];
    return ChromiumView({ url, reloadKey: 0, onNavigate });
  };
  render('https://initial.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1]();
  hooks.effects[2]();
  try {
    listeners.get('did-navigate')!({ url: 'https://initial.example/welcome', isMainFrame: true });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://initial.example/welcome', true);
    render('https://initial.example/welcome');
    hooks.effects[1]();
    listeners.get('dom-ready')!();
    expect(webview.loadURL).not.toHaveBeenCalled();
    render('https://address.example/');
    hooks.effects[1]();
    expect(webview.loadURL).toHaveBeenCalledExactlyOnceWith('https://address.example/');
  } finally { cleanup(); }
});


it('shows main-frame navigation failure with retry and clears feedback when loading resumes', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  const alert = (view: any) => view.props.children?.find((child: any) => child?.props?.role === 'alert');
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    expect(listeners.has('did-fail-load')).toBe(true);
    for (const event of [{ isMainFrame: false, errorCode: -105 }, { isMainFrame: true, errorCode: -3 }]) {
      listeners.get('did-fail-load')!(event);
      expect(alert(render())).toBeUndefined();
    }
    listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
    const feedback = alert(render());
    expect(feedback).toBeDefined();
    expect(JSON.stringify(feedback)).toContain('Unable to load this page');
    const retry = feedback.props.children.find((child: any) => child?.type === 'button');
    expect(retry.props.children).toBe('Retry');
    retry.props.onClick();
    expect(webview.reload).toHaveBeenCalledOnce();
    listeners.get('did-start-loading')!();
    expect(alert(render())).toBeUndefined();
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('handles rejected address loads with feedback while ignoring superseded and cancelled loads', async () => {
  const listeners = new Map<string, (event?: any) => void>();
  const rejects: Array<(reason: unknown) => void> = [];
  const webview = {
    loadURL: vi.fn(() => new Promise<void>((_resolve, reject) => rejects.push(reject))), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (url: string) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url, reloadKey: 0, onNavigate: vi.fn() });
  };
  const alert = (view: any) => view.props.children.find((child: any) => child?.props?.role === 'alert');
  render('https://initial.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    render('https://queued.example/'); hooks.effects[1]();
    listeners.get('dom-ready')!();
    render('https://latest.example/'); hooks.effects[1]();
    rejects[0](new Error('superseded'));
    await Promise.resolve();
    expect(alert(render('https://latest.example/'))).toBeUndefined();
    rejects[1](new Error('network unavailable'));
    await Promise.resolve();
    expect(alert(render('https://latest.example/'))).toBeDefined();
    listeners.get('did-start-loading')!();
    render('https://cancelled.example/'); hooks.effects[1]();
    rejects[2](Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }));
    await Promise.resolve();
    expect(alert(render('https://cancelled.example/'))).toBeUndefined();
    render('https://unmounted.example/'); hooks.effects[1]();
    cleanup();
    rejects[3](new Error('late failure'));
    await Promise.resolve();
    expect(hooks.states[1]).toBe(false);
  } finally { cleanup(); }
});

it('offers recovery when the embedded renderer exits and clears feedback when retry loads', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  const alert = (view: any) => view.props.children.find((child: any) => child?.props?.role === 'alert');
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    listeners.get('dom-ready')!();
    expect(listeners.has('render-process-gone')).toBe(true);
    listeners.get('render-process-gone')!({ reason: 'crashed' });
    const feedback = alert(render());
    expect(feedback).toBeDefined();
    feedback.props.children.find((child: any) => child?.type === 'button').props.onClick();
    expect(webview.reload).toHaveBeenCalledOnce();
    listeners.get('did-start-loading')!();
    expect(alert(render())).toBeUndefined();
    listeners.get('dom-ready')!();
    expect(webview.loadURL).not.toHaveBeenCalled();
    expect(webview.reload).toHaveBeenCalledOnce();
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('announces browser loading and clears busy feedback on completion or failure', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  const status = (view: any) => view.props.children.find((child: any) => child?.props?.role === 'status');
  let view = render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    expect(status(view)?.props.children).toBe('Loading page…');
    expect(view.props.children[0].props['aria-busy']).toBe(true);
    listeners.get('did-stop-loading')!();
    view = render();
    expect(status(view)).toBeUndefined();
    expect(view.props.children[0].props['aria-busy']).toBe(false);
    listeners.get('did-start-loading')!();
    expect(status(render())).toBeDefined();
    listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
    view = render();
    expect(status(view)).toBeUndefined();
    expect(view.props.children[0].props['aria-busy']).toBe(false);
    listeners.get('did-start-loading')!();
    listeners.get('render-process-gone')!();
    expect(status(render())).toBeUndefined();
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('names embedded web content for assistive technology without exposing the address', () => {
  const view = ChromiumView({
    url: 'https://example.com/private-path?token=private', reloadKey: 0, onNavigate: vi.fn(),
  });
  const webview = view.props.children[0];
  expect(webview.type).toBe('webview');
  expect(webview.props['aria-label']).toBe('Web page');
});

it('retries the requested address after a rejected load instead of reloading the previous page', async () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (url: string) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url, reloadKey: 0, onNavigate: vi.fn() });
  };
  render('https://previous.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    listeners.get('dom-ready')!();
    render('https://requested.example/'); hooks.effects[1]();
    await Promise.resolve();
    const view = render('https://requested.example/');
    const alert = view.props.children.find((child: any) => child?.props?.role === 'alert') as any;
    expect(alert).toBeDefined();
    alert.props.children.find((child: any) => child?.type === 'button').props.onClick();
    expect(webview.loadURL).toHaveBeenCalledTimes(2);
    expect(webview.loadURL).toHaveBeenLastCalledWith('https://requested.example/');
    expect(webview.reload).not.toHaveBeenCalled();
    const retrying = render('https://requested.example/');
    expect(retrying.props.children.find((child: any) => child?.props?.role === 'alert')).toBeUndefined();
    expect(retrying.props.children[0].props['aria-busy']).toBe(true);
  } finally { cleanup(); }
});

it('recovers the failed requested address through toolbar Reload', async () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (url: string, reloadKey = 0) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url, reloadKey, onNavigate: vi.fn() });
  };
  render('https://previous.example/');
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1](); hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    render('https://requested.example/'); hooks.effects[1]();
    await Promise.resolve();
    const failed = render('https://requested.example/');
    expect(failed.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(true);
    render('https://requested.example/', 1); hooks.effects[2]();
    expect(webview.loadURL).toHaveBeenCalledTimes(2);
    expect(webview.loadURL).toHaveBeenLastCalledWith('https://requested.example/');
    expect(webview.reload).not.toHaveBeenCalled();
    const retrying = render('https://requested.example/', 1);
    expect(retrying.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
    expect(retrying.props.children[0].props['aria-busy']).toBe(true);
    listeners.get('did-navigate')!({ url: 'https://requested.example/', isMainFrame: true });
    render('https://requested.example/', 2); hooks.effects[2]();
    expect(webview.reload).toHaveBeenCalledOnce();
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it.each(['Retry', 'toolbar Reload'])('immediately replaces current-document failure with loading feedback through %s', (control) => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (reloadKey = 0) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey, onNavigate: vi.fn() });
  };
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1](); hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
    const failed = render();
    const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert') as any;
    expect(alert).toBeDefined();
    if (control === 'Retry') alert.props.children.find((child: any) => child?.type === 'button').props.onClick();
    else { render(1); hooks.effects[2](); }
    expect(webview.reload).toHaveBeenCalledOnce();
    // Feedback must change before the asynchronous did-start-loading event arrives.
    const retrying = render(control === 'Retry' ? 0 : 1);
    expect(retrying.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
    expect(retrying.props.children[0].props['aria-busy']).toBe(true);
    expect(retrying.props.children.some((child: any) => child?.props?.role === 'status')).toBe(true);
    listeners.get('did-stop-loading')!();
    expect(render().props.children[0].props['aria-busy']).toBe(false);
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it.each(['loadURL', 'reload'] as const)('keeps synchronous %s failure recoverable without escaping the renderer handler', (operation) => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = (url: string, reloadKey = 0) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url, reloadKey, onNavigate: vi.fn() });
  };
  const initial = 'https://example.com/';
  const requested = operation === 'loadURL' ? 'https://requested.example/' : initial;
  render(initial);
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1](); hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    webview[operation].mockImplementationOnce(() => { throw new Error('private native failure details'); });
    render(requested, 1);
    expect(() => hooks.effects[operation === 'loadURL' ? 1 : 2]()).not.toThrow();
    const failed = render(requested, 1);
    expect(failed.props.children[0].props['aria-busy']).toBe(false);
    const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert') as any;
    expect(alert).toBeDefined();
    expect(JSON.stringify(alert)).not.toContain('private native failure details');
    expect(() => alert.props.children.find((child: any) => child?.type === 'button').props.onClick()).not.toThrow();
    expect(webview[operation]).toHaveBeenCalledTimes(2);
    if (operation === 'loadURL') expect(webview.loadURL).toHaveBeenLastCalledWith(requested);
    const retrying = render(requested, 1);
    expect(retrying.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
    expect(retrying.props.children[0].props['aria-busy']).toBe(true);
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('keeps a current-page reload active when a superseded address load rejects', async () => {
  const listeners = new Map<string, (event?: any) => void>();
  let rejectAddress!: (reason: unknown) => void;
  const webview = {
    loadURL: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectAddress = reject; })),
    reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const initial = 'https://example.com/';
  const render = (url = initial, reloadKey = 0) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url, reloadKey, onNavigate: vi.fn() });
  };
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1](); hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    render('https://pending.example/'); hooks.effects[1]();
    // Return to the landed address, then reload while that load is pending.
    render(initial); hooks.effects[1]();
    render(initial, 1); hooks.effects[2]();
    expect(webview.reload).toHaveBeenCalledOnce();
    rejectAddress(new Error('superseded address failure'));
    await Promise.resolve();
    const reloading = render(initial, 1);
    expect(reloading.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
    expect(reloading.props.children[0].props['aria-busy']).toBe(true);
    listeners.get('did-stop-loading')!();
    expect(render(initial, 1).props.children[0].props['aria-busy']).toBe(false);
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('replaces reload redirects in history while preserving subsequent link navigation', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const onNavigate = vi.fn();
  const initial = 'https://example.com/';
  const render = (reloadKey = 0) => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: initial, reloadKey, onNavigate });
  };
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  hooks.effects[1](); hooks.effects[2]();
  try {
    listeners.get('dom-ready')!();
    listeners.get('did-navigate')!({ url: initial, isMainFrame: true });
    onNavigate.mockClear();
    render(1); hooks.effects[2]();
    expect(webview.reload).toHaveBeenCalledOnce();
    listeners.get('did-navigate')!({ url: 'https://example.com/welcome', isMainFrame: true });
    expect(onNavigate).toHaveBeenLastCalledWith('https://example.com/welcome', true);
    listeners.get('did-navigate')!({ url: 'https://example.com/link', isMainFrame: true });
    expect(onNavigate).toHaveBeenLastCalledWith('https://example.com/link', false);
  } finally { cleanup(); }
  expect(listeners.size).toBe(0);
});

it('ignores a retained browser Retry action after its view closes', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
  const failed = render();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert') as any;
  const retry = alert.props.children.find((child: any) => child?.type === 'button');
  retry.props.onClick();
  expect(webview.reload).toHaveBeenCalledOnce();
  cleanup();
  webview.reload.mockClear();
  const closedState = [...hooks.states];
  retry.props.onClick();
  expect(webview.reload).not.toHaveBeenCalled();
  expect(webview.loadURL).not.toHaveBeenCalled();
  expect(hooks.states).toEqual(closedState);
  expect(listeners.size).toBe(0);
});

it('returns focus to the web page when Retry removes the focused recovery button', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined), reload: vi.fn(), focus: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    listeners.get('dom-ready')!();
    listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
    const alert = render().props.children.find((child: any) => child?.props?.role === 'alert') as any;
    alert.props.children.find((child: any) => child?.type === 'button').props.onClick();
    expect(webview.reload).toHaveBeenCalledOnce();
    expect(webview.focus).toHaveBeenCalledOnce();
    expect(render().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
    cleanup();
    webview.focus.mockClear();
    alert.props.children.find((child: any) => child?.type === 'button').props.onClick();
    expect(webview.focus).not.toHaveBeenCalled();
  } finally { cleanup(); }
});

it('keeps focus on Retry when the native reload fails immediately', () => {
  const listeners = new Map<string, (event?: any) => void>();
  const webview = {
    loadURL: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockImplementationOnce(() => { throw new Error('native unavailable'); }),
    focus: vi.fn(),
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const render = () => {
    hooks.cursor = 0; hooks.stateCursor = 0; hooks.effects = [];
    return ChromiumView({ url: 'https://example.com/', reloadKey: 0, onNavigate: vi.fn() });
  };
  const alert = (view: any) => view.props.children.find((child: any) => child?.props?.role === 'alert');
  render();
  hooks.refs[0].current = webview;
  const cleanup = hooks.effects[0]();
  try {
    listeners.get('dom-ready')!();
    listeners.get('did-fail-load')!({ isMainFrame: true, errorCode: -105 });
    const retry = alert(render()).props.children.find((child: any) => child?.type === 'button');
    expect(() => retry.props.onClick()).not.toThrow();
    expect(alert(render())).toBeDefined();
    expect(webview.focus).not.toHaveBeenCalled();
    // The retained recovery button can start a later successful retry.
    retry.props.onClick();
    expect(alert(render())).toBeUndefined();
    expect(webview.focus).toHaveBeenCalledOnce();
  } finally { cleanup(); }
});
