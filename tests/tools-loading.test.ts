import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => any)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => any) => { hooks.effects.push(effect); },
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
}));
import { ToolsPanel } from '../src/components/ToolsPanel';
afterEach(() => { hooks.values = []; hooks.cursor = 0; hooks.effects = []; vi.unstubAllGlobals(); });
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

it('announces initial loading and safely recovers a rejected refresh through retry', async () => {
  const state = { servers: [], skills: [] };
  const bridge = { state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockRejectedValueOnce(new Error('/private/config')).mockResolvedValue(state) };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  expect(nodes(render()).some(n => n.props?.role === 'status' && n.props.children === 'Loading tools…')).toBe(true);
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  const failed = nodes(render());
  expect(failed.find(n => n.props?.role === 'alert')?.props.children).toBe('Could not load tools. Try again.');
  const retry = failed.find(n => n.type === 'button' && n.props.children === 'Retry');
  expect(retry).toBeDefined();
  await retry.props.onClick();
  expect(bridge.refresh).toHaveBeenCalledTimes(2);
  expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(false);
});

it('announces safe scan failures and lets a successful retry open the preview', async () => {
  const scan = { servers: [], skills: [], notes: [] };
  const bridge = {
    state: vi.fn().mockResolvedValue({ servers: [], skills: [] }),
    refresh: vi.fn().mockResolvedValue({ servers: [], skills: [] }),
    scan: vi.fn().mockRejectedValueOnce(new Error('/private/config token=secret')).mockResolvedValue(scan),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  const importButton = () => nodes(render()).find(n => n.type === 'button' && n.props.children === 'Import…');
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(importButton().props.disabled).toBe(false));
  importButton().props.onClick();
  await vi.waitFor(() => expect(bridge.scan).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  const failed = nodes(render());
  expect(failed.find(n => n.props?.role === 'alert')?.props.children).toBe('Could not complete the tools action. Try again.');
  expect(JSON.stringify(failed)).not.toContain('token=secret');
  expect(importButton().props.disabled).toBe(false);
  importButton().props.onClick();
  await vi.waitFor(() => expect(bridge.scan).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(render().props.scan).toEqual(scan);
});

it('keeps successful import feedback and offers retry when the following refresh fails', async () => {
  const state = { servers: [], skills: [] };
  const scan = { servers: [], skills: [], notes: [] };
  const bridge = {
    scan: vi.fn().mockResolvedValue(scan),
    import: vi.fn().mockResolvedValue({ servers: 1, skills: 0, failed: [] }),
    state: vi.fn().mockResolvedValue(state),
    refresh: vi.fn().mockRejectedValueOnce(new Error('/private/config')).mockResolvedValue(state),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  nodes(render()).find(n => n.type === 'button' && n.props.children === 'Import…').props.onClick();
  await vi.waitFor(() => expect(render().props.scan).toEqual(scan));
  await expect(render().props.onImport(['server'])).resolves.toBeUndefined();
  const failed = nodes(render());
  expect(failed.find(n => n.props?.role === 'status')?.props.children).toBe('Imported 1 server and 0 skills.');
  expect(failed.find(n => n.props?.role === 'alert')?.props.children).toBe('Could not load tools. Try again.');
  await failed.find(n => n.type === 'button' && n.props.children === 'Retry').props.onClick();
  expect(bridge.import).toHaveBeenCalledTimes(1);
  expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(false);
});

it('announces unsuccessful tools sign-in safely and clears the alert on successful retry', async () => {
  const state = { servers: [{ id: 'server', name: 'Example', label: 'Local', status: 'needs-auth', enabled: true }], skills: [] };
  const bridge = {
    state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockResolvedValue(state),
    signIn: vi.fn().mockResolvedValueOnce({ ok: false, error: '/private/config token=secret', state })
      .mockResolvedValue({ ok: true, state }),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  const signIn = () => nodes(render()).find(n => n.type === 'button' && n.props.children === 'Sign in');
  signIn().props.onClick();
  await vi.waitFor(() => expect(nodes(render()).find(n => n.props?.role === 'alert')?.props.children)
    .toBe('Could not sign in to the tools server. Try again.'));
  expect(JSON.stringify(nodes(render()))).not.toContain('token=secret');
  expect(signIn().props.disabled).toBe(false);
  signIn().props.onClick();
  await vi.waitFor(() => expect(bridge.signIn).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(false);
});

it('disables conflicting tools controls during a pending mutation and restores them after failure', async () => {
  const state = { servers: [{ id: 'server', name: 'Example', label: 'Local', status: 'needs-auth', enabled: true }], skills: [{ id: 'skill', name: 'Writing', label: 'Local' }] };
  let rejectRemoval!: (error: Error) => void;
  const bridge = {
    state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockResolvedValue(state),
    removeServer: vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectRemoval = reject; })),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  const controls = () => nodes(render()).filter(n => n.type === 'button' || n.type === 'input');
  controls().find(n => n.props.children === 'Remove').props.onClick();
  expect(bridge.removeServer).toHaveBeenCalledTimes(1);
  expect(controls().every(n => n.props.disabled === true)).toBe(true);
  rejectRemoval(new Error('unavailable'));
  await vi.waitFor(() => expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(true));
  expect(controls().every(n => !n.props.disabled)).toBe(true);
});

it('shows the MCP empty state only after a successful load, never during loading or a failed refresh', async () => {
  const state = { servers: [], skills: [] };
  const bridge = {
    state: vi.fn().mockResolvedValue(state),
    refresh: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(state),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  const empty = () => nodes(render()).some(n => n.props?.children === 'No MCP servers yet. Import servers to connect your tools.');
  expect(empty()).toBe(false);
  hooks.effects[0]();
  await vi.waitFor(() => expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(true));
  expect(empty()).toBe(false);
  await nodes(render()).find(n => n.type === 'button' && n.props.children === 'Retry').props.onClick();
  expect(empty()).toBe(true);
});

it('disables tools mutations until the pending live refresh finishes', async () => {
  const state = { servers: [{ id: 'server', name: 'Example', label: 'Local', status: 'needs-auth', enabled: true }], skills: [{ id: 'skill', name: 'Writing', label: 'Local' }] };
  let finishRefresh!: (value: typeof state) => void;
  const bridge = {
    state: vi.fn().mockResolvedValue(state),
    refresh: vi.fn().mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; })),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  const controls = () => nodes(render()).filter(n => n.type === 'button' || n.type === 'input');
  expect(controls().every(n => n.props.disabled === true)).toBe(true);
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  expect(controls()).toHaveLength(5);
  expect(controls().every(n => n.props.disabled === true)).toBe(true);
  finishRefresh(state);
  await vi.waitFor(() => expect(controls().every(n => !n.props.disabled)).toBe(true));
});

it('identifies the server or skill in each removal button accessible name', async () => {
  const state = {
    servers: [{ id: 'server', name: 'Calendar', label: 'Local', status: 'off', enabled: false }],
    skills: [{ id: 'skill', name: 'Writing', label: 'Local' }],
  };
  const bridge = { state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockResolvedValue(state) };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  const removals = nodes(render()).filter(n => n.type === 'button' && n.props.children === 'Remove');
  expect(removals.map(n => n.props['aria-label'])).toEqual(['Remove server Calendar', 'Remove skill Writing']);
});

it('announces successful removal by name and never reports success for a rejected removal', async () => {
  const skill = { id: 'skill', name: 'Writing', label: 'Local' };
  const server = { id: 'server', name: 'Calendar', label: 'Local', status: 'off', enabled: false };
  const state = { servers: [server], skills: [skill] };
  const bridge = {
    state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockResolvedValue(state),
    removeServer: vi.fn().mockResolvedValue({ servers: [], skills: [skill] }),
    removeSkill: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ servers: [], skills: [] }),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  const remove = (name: string) => nodes(render()).find(n => n.type === 'button' && n.props['aria-label'] === name);
  const status = () => nodes(render()).find(n => n.props?.role === 'status')?.props.children;
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(remove('Remove server Calendar').props.disabled).toBe(false));
  remove('Remove server Calendar').props.onClick();
  await vi.waitFor(() => expect(status()).toBe('Removed server Calendar.'));
  expect(remove('Remove server Calendar')).toBeUndefined();
  remove('Remove skill Writing').props.onClick();
  await vi.waitFor(() => expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(true));
  expect(status()).not.toBe('Removed skill Writing.');
  expect(remove('Remove skill Writing')).toBeDefined();
  remove('Remove skill Writing').props.onClick();
  await vi.waitFor(() => expect(status()).toBe('Removed skill Writing.'));
  expect(remove('Remove skill Writing')).toBeUndefined();
});

it('serializes conflicting tools actions before rerender and releases the guard after failure', async () => {
  const state = { servers: [{ id: 'server', name: 'Example', label: 'Local', status: 'needs-auth', enabled: true }], skills: [] };
  let rejectRemoval!: (error: Error) => void;
  const bridge = {
    state: vi.fn().mockResolvedValue(state), refresh: vi.fn().mockResolvedValue(state),
    removeServer: vi.fn(() => new Promise((_resolve, reject) => { rejectRemoval = reject; })),
    signIn: vi.fn().mockResolvedValue({ ok: true, state }),
  };
  vi.stubGlobal('window', { jarvis: { tools: bridge } });
  const render = () => { hooks.cursor = 0; return ToolsPanel(); };
  render();
  hooks.effects[0]();
  await vi.waitFor(() => expect(bridge.refresh).toHaveBeenCalledTimes(1));
  const ready = nodes(render());
  const remove = ready.find(n => n.props?.['aria-label'] === 'Remove server Example').props.onClick;
  const signIn = ready.find(n => n.type === 'button' && n.props.children === 'Sign in').props.onClick;
  remove();
  try {
    signIn();
    expect(bridge.removeServer).toHaveBeenCalledTimes(1);
    expect(bridge.signIn).not.toHaveBeenCalled();
  } finally {
    rejectRemoval(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(true);
  signIn();
  await vi.waitFor(() => expect(bridge.signIn).toHaveBeenCalledTimes(1));
  expect(nodes(render()).some(n => n.props?.role === 'alert')).toBe(false);
});
