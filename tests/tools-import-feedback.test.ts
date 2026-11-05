import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next;
    }];
  },
}));
import { ToolsPanel } from '../src/components/ToolsPanel';
afterEach(() => { hooks.values = []; hooks.cursor = 0; vi.unstubAllGlobals(); });

it('retains selected tools after a failed import, announces a safe error, and permits retry', async () => {
  const scan = { servers: [], skills: [{ id: 'skill', name: 'Writing', label: 'Local', description: '', selected: true }], notes: [] };
  vi.stubGlobal('window', { jarvis: { tools: {} } });
  hooks.values = [null, scan, null, null];
  const preview = ToolsPanel() as any;
  hooks.values = [];
  const onImport = vi.fn().mockRejectedValueOnce(new Error('/private/config')).mockResolvedValueOnce(undefined);
  const render = () => { hooks.cursor = 0; return preview.type({ ...preview.props, onImport }); };
  const button = (view: any) => view.props.children.at(-1).props.children[1];
  const pending = button(render()).props.onClick();
  expect(button(render()).props.disabled).toBe(true);
  await pending;
  const failed = render();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not import. Your selections are still here. Try again.');
  expect(button(failed).props.disabled).toBe(false);
  await button(failed).props.onClick();
  expect(onImport.mock.calls).toEqual([[['skill']], [['skill']]]);
  expect(render().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
});

it('keeps the import preview stable until the pending import settles', async () => {
  const scan = { servers: [], skills: [{ id: 'skill', name: 'Writing', label: 'Local', description: '', selected: true }], notes: [] };
  vi.stubGlobal('window', { jarvis: { tools: {} } });
  hooks.values = [null, scan, null, null];
  const preview = ToolsPanel() as any;
  hooks.values = [];
  let rejectImport!: (error: Error) => void;
  const onImport = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectImport = reject; }));
  const render = () => { hooks.cursor = 0; return preview.type({ ...preview.props, onImport }); };
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const controls = () => nodes(render()).filter(n => n.type === 'button' || n.type === 'input');
  const pending = controls().find(n => n.props.className === 'add-btn').props.onClick();
  expect(controls().every(n => n.props.disabled === true)).toBe(true);
  rejectImport(new Error('unavailable'));
  await pending;
  expect(controls().every(n => !n.props.disabled)).toBe(true);
  expect(controls().find(n => n.type === 'input').props.checked).toBe(true);
  expect(onImport).toHaveBeenCalledExactlyOnceWith(['skill']);
});


it('starts only one tools import before rerender and unlocks after failure for retry', async () => {
  const scan = { servers: [], skills: [{ id: 'skill', name: 'Writing', label: 'Local', description: '', selected: true }], notes: [] };
  vi.stubGlobal('window', { jarvis: { tools: {} } });
  hooks.values = [null, scan, null, null];
  const preview = ToolsPanel() as any;
  hooks.values = [];
  let rejectImport!: (error: Error) => void;
  const onImport = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectImport = reject; }))
    .mockResolvedValue(undefined);
  const render = () => { hooks.cursor = 0; return preview.type({ ...preview.props, onImport }); };
  const button = (view: any) => view.props.children.at(-1).props.children[1];
  const activate = button(render()).props.onClick;
  const pending = activate();
  try {
    await activate();
    expect(onImport).toHaveBeenCalledExactlyOnceWith(['skill']);
  } finally {
    rejectImport(new Error('unavailable'));
    await pending;
  }
  expect(button(render()).props.disabled).toBe(false);
  await button(render()).props.onClick();
  expect(onImport).toHaveBeenCalledTimes(2);
  expect(render().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
});
