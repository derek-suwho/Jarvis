import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)>, render: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (next: unknown) => { state.values[index] = next; }];
  },
  useRef: (current: unknown) => ({ current }),
  useId: () => 'diagram',
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), ''] }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: state.render } }));
import { Artifact } from '../src/components/Artifact';
import { HEIGHT_MESSAGE } from '../src/lib/artifacts';

afterEach(() => { state.values = []; state.index = 0; state.effects = []; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('shows loading instead of the previous diagram while edited source renders, then shows the new diagram', async () => {
  vi.stubGlobal('window', {});
  const card = Artifact({ kind: 'mermaid', text: 'graph TD; A-->B', streaming: false });
  const preview = card.props.children[3].props.children[0];
  state.values = []; state.effects = [];
  const render = (source: string) => {
    state.index = 0; state.effects = [];
    return preview.type({ source });
  };
  let complete!: (value: { svg: string }) => void;
  state.render.mockResolvedValueOnce({ svg: '<svg>old</svg>' })
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render('graph TD; A-->B');
  const cleanup = state.effects[0]();
  await vi.waitFor(() => expect(state.values[0]).toBe('<svg>old</svg>'));
  expect(render('graph TD; A-->B').type).toBe('img');
  if (cleanup) cleanup();
  render('graph TD; A-->C');
  const nextCleanup = state.effects[0]();
  try {
    const pending = render('graph TD; A-->C');
    expect(pending.props.className).toBe('artifact-loading');
    expect(pending.props.children).toBe('Drawing diagram…');
    await vi.waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
    complete({ svg: '<svg>new</svg>' });
    await vi.waitFor(() => expect(state.values[0]).toBe('<svg>new</svg>'));
    expect(render('graph TD; A-->C').props.src).toContain('new');
  } finally { if (nextCleanup) nextCleanup(); }
});

it('exposes asynchronous diagram loading and failure feedback to assistive technology', async () => {
  vi.stubGlobal('window', {});
  const card = Artifact({ kind: 'mermaid', text: 'invalid diagram', streaming: false });
  const preview = card.props.children[3].props.children[0];
  state.values = []; state.effects = [];
  const render = () => {
    state.index = 0; state.effects = [];
    return preview.type({ source: 'invalid diagram' });
  };
  state.render.mockRejectedValueOnce(new Error('Invalid diagram syntax'));
  const pending = render();
  expect(pending.props.role).toBe('status');
  expect(pending.props.children).toBe('Drawing diagram…');
  const cleanup = state.effects[0]();
  try {
    await vi.waitFor(() => expect(state.values[1]).toBe('Invalid diagram syntax'));
    const failed = render();
    expect(failed.props.role).toBe('alert');
    expect(failed.props.children.join('')).toContain('Invalid diagram syntax');
  } finally { if (cleanup) cleanup(); }
});

it('reports an unreadable SVG preview and recovers when its source is edited', () => {
  const card = Artifact({ kind: 'svg', text: '<svg>broken', streaming: false });
  const preview = card.props.children[3].props.children[1];
  state.values = []; state.effects = [];
  const render = (source: string) => {
    state.index = 0; state.effects = [];
    return typeof preview.type === 'function' ? preview.type({ source }) : preview;
  };
  const image = render('<svg>broken');
  expect(image.type).toBe('img');
  expect(image.props.onError).toBeTypeOf('function');
  image.props.onError();
  const failed = render('<svg>broken');
  expect(failed.props.role).toBe('alert');
  expect(failed.props.children).toContain('Code');
  render('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const recovered = render('<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(recovered.type).toBe('img');
  expect(recovered.props.src).toContain('xmlns');
});

it('reports diagram image decode failures and recovers after a source edit', async () => {
  vi.stubGlobal('window', {});
  const card = Artifact({ kind: 'mermaid', text: 'graph TD; A-->B', streaming: false });
  const preview = card.props.children[3].props.children[0];
  state.values = []; state.effects = [];
  const render = (source: string) => {
    state.index = 0; state.effects = [];
    return preview.type({ source });
  };
  state.render.mockResolvedValueOnce({ svg: '<svg>unreadable</svg>' })
    .mockResolvedValueOnce({ svg: '<svg>repaired</svg>' });
  render('graph TD; A-->B');
  const cleanup = state.effects[0]();
  await vi.waitFor(() => expect(state.values[0]).toBe('<svg>unreadable</svg>'));
  const image = render('graph TD; A-->B');
  expect(image.props.onError).toBeTypeOf('function');
  image.props.onError();
  const failed = render('graph TD; A-->B');
  expect(failed.props.role).toBe('alert');
  expect(failed.props.children.join('')).toContain('Code');
  if (cleanup) cleanup();
  render('graph TD; A-->C');
  const nextCleanup = state.effects[0]();
  try {
    expect(render('graph TD; A-->C').props.role).toBe('status');
    await vi.waitFor(() => expect(state.values[0]).toBe('<svg>repaired</svg>'));
    const repaired = render('graph TD; A-->C');
    expect(repaired.type).toBe('img');
    expect(repaired.props.src).toContain('repaired');
  } finally { if (nextCleanup) nextCleanup(); }
});

it('resets an edited HTML preview height until the replacement document reports its size', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const card = Artifact({ kind: 'html', text: '<p>Old page</p>', streaming: false });
  const preview = card.props.children[3].props.children[2];
  state.values = []; state.effects = [];
  const render = (html: string) => {
    state.index = 0; state.effects = [];
    return preview.type({ html, fill: false }).props.children.find((child: any) => child?.type === 'iframe');
  };
  const frame = render('<p>Old page</p>');
  const contentWindow = {};
  frame.ref.current = { contentWindow };
  state.effects.forEach((effect) => effect());
  try {
    listeners.get('message')!({ source: contentWindow, data: { type: HEIGHT_MESSAGE, height: 120 } });
    expect(render('<p>Old page</p>').props.style.height).toBe(120);
    render('<p>New page without scripts</p>');
    state.effects.forEach((effect) => effect());
    expect(render('<p>New page without scripts</p>').props.style.height).toBe(360);
  } finally { listeners.clear(); }
});


it('announces HTML preview loading until the page loads and restarts feedback for an edited page', () => {
  const card = Artifact({ kind: 'html', text: '<p>Page</p>', streaming: false });
  const preview = card.props.children[3].props.children[2];
  state.values = []; state.effects = [];
  const render = (html: string) => {
    state.index = 0; state.effects = [];
    return preview.type({ html, fill: false });
  };
  const pending = render('<p>Page</p>');
  const children = (view: any) => Array.isArray(view.props.children) ? view.props.children : [view];
  const status = children(pending).find((child: any) => child?.props?.role === 'status');
  expect(status?.props.children).toBe('Loading page preview…');
  const frame = children(pending).find((child: any) => child?.type === 'iframe');
  expect(frame.props['aria-busy']).toBe(true);
  frame.props.onLoad();
  const loaded = render('<p>Page</p>');
  expect(children(loaded).some((child: any) => child?.props?.role === 'status')).toBe(false);
  expect(children(loaded).find((child: any) => child?.type === 'iframe').props['aria-busy']).toBe(false);
  const edited = render('<p>Edited page</p>');
  expect(children(edited).find((child: any) => child?.props?.role === 'status')?.props.children).toBe('Loading page preview…');
  children(edited).find((child: any) => child?.type === 'iframe').props.onLoad();
  expect(children(render('<p>Edited page</p>')).some((child: any) => child?.props?.role === 'status')).toBe(false);
});

it('replaces HTML loading feedback with an accessible failure and allows an edited page to load', () => {
  const card = Artifact({ kind: 'html', text: '<p>Page</p>', streaming: false });
  const preview = card.props.children[3].props.children[2];
  state.values = []; state.effects = [];
  const render = (html: string) => {
    state.index = 0; state.effects = [];
    return preview.type({ html, fill: false });
  };
  const children = (view: any) => view.props.children;
  const frame = (view: any) => children(view).find((child: any) => child?.type === 'iframe');
  const pending = render('<p>Page</p>');
  expect(frame(pending).props.onError).toBeTypeOf('function');
  frame(pending).props.onError();
  const failed = render('<p>Page</p>');
  expect(children(failed).find((child: any) => child?.props?.role === 'alert')?.props.children).toContain('Open Code');
  expect(children(failed).some((child: any) => child?.props?.role === 'status')).toBe(false);
  expect(frame(failed).props['aria-busy']).toBe(false);
  const edited = render('<p>Repaired page</p>');
  expect(children(edited).some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(frame(edited).props['aria-busy']).toBe(true);
  frame(edited).props.onLoad();
  expect(frame(render('<p>Repaired page</p>')).props['aria-busy']).toBe(false);
});
