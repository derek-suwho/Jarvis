import { afterEach, expect, it, vi } from 'vitest';
import type { TaskResult, TaskSnapshot } from '../src/shared/tasks';

const state = vi.hoisted(() => ({ error: '', setError: vi.fn(), working: false, setWorking: vi.fn(), layouts: [] as Array<() => void>, cleanups: [] as Array<() => void> }));
afterEach(() => { state.error = ''; state.working = false; state.cleanups.length = 0; state.layouts.length = 0; vi.clearAllMocks(); });

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => value === '' ? [state.error, state.setError] : [state.working, state.setWorking],
  useId: () => 'queue',
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) state.cleanups.push(cleanup);
  },
  useLayoutEffect: (effect: () => void) => { state.layouts.push(effect); },
  useRef: (current: unknown) => ({ current }),
}));
import { TaskQueue } from '../src/components/TaskQueue';

it('serializes rapid queue actions and releases the controls after a rejected action', async () => {
  let reject!: (error: Error) => void;
  const onInterrupt = vi.fn(() => new Promise<TaskResult>((_resolve, fail) => { reject = fail; }));
  const onRemove = vi.fn(async (): Promise<TaskResult> => ({ ok: false, code: 'unavailable', message: 'Try again' }));
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const view = TaskQueue({ task, onInterrupt, onRemove })!;
  const interrupt = view.props.children[0].props.children[1];
  const remove = view.props.children[1].props.children[0].props.children[1];
  interrupt.props.onClick();
  interrupt.props.onClick();
  remove.props.onClick();
  expect(onInterrupt).toHaveBeenCalledOnce();
  expect(onRemove).not.toHaveBeenCalled();
  reject(new Error('Disconnected'));
  await Promise.resolve();
  await Promise.resolve();
  remove.props.onClick();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  await Promise.resolve();
});

it('associates failed queue actions with their alert and clears the description on retry', async () => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const onInterrupt = vi.fn(async (): Promise<TaskResult> => ({ ok: true, task }));
  const onRemove = vi.fn()
    .mockResolvedValueOnce({ ok: false, code: 'unavailable', message: 'Try again' })
    .mockResolvedValueOnce({ ok: true });
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const render = () => TaskQueue({ task, onInterrupt, onRemove })!;
  const controls = (view: any) => [
    view.props.children[0].props.children[1],
    view.props.children[1].props.children[0].props.children[1],
  ];
  expect(controls(render()).every((control) => control.props['aria-describedby'] === undefined)).toBe(true);
  controls(render())[1].props.onClick();
  await Promise.resolve();
  const failed = render();
  const alert = failed.props.children[2];
  expect(alert.props.role).toBe('alert');
  expect(alert.props.children).toBe('Try again');
  expect(alert.props.id).toBe('queue-error');
  for (const control of controls(failed)) expect(control.props['aria-describedby']).toBe(alert.props.id);
  controls(failed)[1].props.onClick();
  await Promise.resolve();
  expect(onRemove).toHaveBeenCalledTimes(2);
  expect(render().props.children[2]).toBe('');
  for (const control of controls(render())) expect(control.props['aria-describedby']).toBeUndefined();
});

it('keeps a late action failure visible after a live update empties the queue', async () => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  let reject!: (error: Error) => void;
  const onRemove = vi.fn(() => new Promise<TaskResult>((_resolve, fail) => { reject = fail; }));
  const onInterrupt = vi.fn();
  let task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const render = () => TaskQueue({ task, onInterrupt, onRemove });
  render()!.props.children[1].props.children[0].props.children[1].props.onClick();
  task = { ...task, state: 'complete', queue: [] };
  expect(render()).toBeNull();
  reject(new Error('Disconnected'));
  await Promise.resolve();
  await Promise.resolve();
  const failed = render();
  expect(failed).not.toBeNull();
  expect(failed!.props.children[2].props.role).toBe('alert');
  expect(failed!.props.children[2].props.children).toBe('Could not confirm this update. Check the task before trying again.');
  expect(failed!.props.children[0].props.children[1].props.disabled).toBe(true);
});

it('dismisses a stale queue error without invoking another task action', () => {
  state.error = 'Could not confirm this update. Check the task before trying again.';
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const task = { state: 'complete', queue: [] } as unknown as TaskSnapshot;
  const onRemove = vi.fn();
  const onInterrupt = vi.fn();
  const render = () => TaskQueue({ task, onRemove, onInterrupt });
  const dismiss = render()!.props.children[3];
  expect(dismiss?.props['aria-label']).toBe('Dismiss queue error');
  dismiss.props.onClick();
  expect(render()).toBeNull();
  expect(onRemove).not.toHaveBeenCalled();
  expect(onInterrupt).not.toHaveBeenCalled();
});

it('keeps pending queue feedback visible when a live update empties the queue, then hides on success', async () => {
  state.setWorking.mockImplementation((value: boolean) => { state.working = value; });
  let resolve!: (result: TaskResult) => void;
  const onRemove = vi.fn(() => new Promise<TaskResult>((done) => { resolve = done; }));
  const onInterrupt = vi.fn();
  let task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const render = () => TaskQueue({ task, onRemove, onInterrupt });
  render()!.props.children[1].props.children[0].props.children[1].props.onClick();
  task = { ...task, state: 'complete', queue: [] };
  const pending = render();
  expect(pending).not.toBeNull();
  expect(pending!.props.children[0].props.children[0].props.role).toBe('status');
  expect(pending!.props.children[0].props.children[0].props.children).toBe('Updating queued messages…');
  expect(pending!.props.children[0].props.children[1].props.disabled).toBe(true);
  resolve({ ok: true, task });
  await Promise.resolve();
  expect(render()).toBeNull();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  expect(onInterrupt).not.toHaveBeenCalled();
});


it('asks users to check task state after an unknown queue mutation outcome', async () => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const onRemove = vi.fn().mockRejectedValue(new Error('Connection lost after dispatch'));
  const onInterrupt = vi.fn();
  const render = () => TaskQueue({ task, onRemove, onInterrupt })!;
  render().props.children[1].props.children[0].props.children[1].props.onClick();
  await Promise.resolve();
  expect(render().props.children[2].props.role).toBe('alert');
  expect(render().props.children[2].props.children).toBe('Could not confirm this update. Check the task before trying again.');
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  expect(onInterrupt).not.toHaveBeenCalled();
});


it.each(['failure', 'rejection', 'success'])('ignores a late queue %s after the panel unmounts', async (outcome) => {
  let resolve!: (result: TaskResult) => void;
  let reject!: (error: Error) => void;
  const onRemove = vi.fn(() => new Promise<TaskResult>((done, fail) => { resolve = done; reject = fail; }));
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const view = TaskQueue({ task, onRemove, onInterrupt: vi.fn() })!;
  view.props.children[1].props.children[0].props.children[1].props.onClick();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  state.cleanups.forEach((cleanup) => cleanup());
  state.setError.mockClear();
  state.setWorking.mockClear();
  if (outcome === 'rejection') reject(new Error('Disconnected'));
  else resolve(outcome === 'success' ? { ok: true, task } : { ok: false, code: 'unavailable', message: 'Try again' });
  await Promise.resolve();
  await Promise.resolve();
  expect(state.setError).not.toHaveBeenCalled();
  expect(state.setWorking).not.toHaveBeenCalled();
});


it('exposes queue updates as busy to assistive technology until the action settles', async () => {
  state.setWorking.mockImplementation((value: boolean) => { state.working = value; });
  let resolve!: (result: TaskResult) => void;
  const onRemove = vi.fn(() => new Promise<TaskResult>((done) => { resolve = done; }));
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const render = () => TaskQueue({ task, onRemove, onInterrupt: vi.fn() })!;
  expect(render().props.children[1].props['aria-busy']).toBe(false);
  render().props.children[1].props.children[0].props.children[1].props.onClick();
  expect(render().props.children[1].props['aria-busy']).toBe(true);
  resolve({ ok: true, task });
  await Promise.resolve();
  expect(render().props.children[1].props['aria-busy']).toBe(false);
});

it('keeps the queue busy during backend interruption and application until it settles', () => {
  const queued = { id: 'queued-1', state: 'queued', message: { content: 'Follow up' } };
  const render = (task: TaskSnapshot) => TaskQueue({ task, onRemove: vi.fn(), onInterrupt: vi.fn() });
  const task = { state: 'running', queue: [queued] } as TaskSnapshot;
  expect(render(task)!.props.children[1].props['aria-busy']).toBe(false);
  expect(render({ ...task, state: 'interrupting' })!.props.children[1].props['aria-busy']).toBe(true);
  expect(render({ ...task, queue: [{ ...task.queue[0], state: 'applying' }] })!.props.children[1].props['aria-busy']).toBe(true);
  expect(render(task)!.props.children[1].props['aria-busy']).toBe(false);
  expect(render({ ...task, state: 'complete', queue: [] })).toBeNull();
});

it('cannot remove messages or interrupt a task through retained controls after the queue panel closes', async () => {
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const onRemove = vi.fn(async (): Promise<TaskResult> => ({ ok: true, task }));
  const onInterrupt = vi.fn(async (): Promise<TaskResult> => ({ ok: true, task }));
  const view = TaskQueue({ task, onRemove, onInterrupt })!;
  const interrupt = view.props.children[0].props.children[1];
  const remove = view.props.children[1].props.children[0].props.children[1];
  state.cleanups.forEach((cleanup) => cleanup());
  remove.props.onClick();
  await Promise.resolve();
  interrupt.props.onClick();
  await Promise.resolve();
  expect(onRemove).not.toHaveBeenCalled();
  expect(onInterrupt).not.toHaveBeenCalled();
  expect(state.setError).not.toHaveBeenCalled();
  expect(state.setWorking).not.toHaveBeenCalled();
  // A newly mounted panel still supports ordinary queue operations.
  const reopened = TaskQueue({ task, onRemove, onInterrupt })!;
  reopened.props.children[1].props.children[0].props.children[1].props.onClick();
  await Promise.resolve();
  reopened.props.children[0].props.children[1].props.onClick();
  await Promise.resolve();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  expect(onInterrupt).toHaveBeenCalledOnce();
});

it('identifies attachment-only queued messages by filename before removal', () => {
  const onRemove = vi.fn();
  const entries = [
    { id: 'report', state: 'queued', message: { content: '   ', attachments: [{ id: 'a', name: 'Quarterly report.pdf' }, { id: 'b', name: 'Chart.png' }] } },
    { id: 'notes', state: 'queued', message: { content: '', attachments: [{ id: 'c', name: 'Meeting notes.txt' }] } },
    { id: 'empty', state: 'queued', message: { content: '', attachments: [] } },
  ];
  const task = { state: 'running', queue: entries } as TaskSnapshot;
  const view = TaskQueue({ task, onRemove, onInterrupt: vi.fn() })!;
  const buttons = view.props.children[1].props.children.map((row: any) => row.props.children[1]);
  expect(buttons.map((button: any) => button.props['aria-label'])).toEqual([
    'Remove queued message: Quarterly report.pdf, Chart.png',
    'Remove queued message: Meeting notes.txt',
    'Remove queued message: Attachment',
  ]);
  expect(onRemove).not.toHaveBeenCalled();
  buttons[1].props.onClick();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('notes');
});

it('recovers keyboard focus after removal only when the focused queue control disappeared', async () => {
  const task = { state: 'running', queue: [{ id: 'queued-1', state: 'queued', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const body = {};
  const control = { isConnected: true };
  const elsewhere = {};
  const document = { activeElement: control as unknown, body };
  vi.stubGlobal('document', document);
  try {
    for (const movedElsewhere of [false, true]) {
      let resolve!: (result: TaskResult) => void;
      const onRemove = vi.fn(() => new Promise<TaskResult>((done) => { resolve = done; }));
      const view = TaskQueue({ task, onRemove, onInterrupt: vi.fn() })!;
      const focus = vi.fn();
      const section = { contains: (node: unknown) => node === control, focus, isConnected: true };
      (view as any).ref.current = section;
      view.props.onFocusCapture({ target: control });
      control.isConnected = true;
      document.activeElement = control;
      view.props.children[1].props.children[0].props.children[1].props.onClick();
      control.isConnected = false;
      document.activeElement = movedElsewhere ? elsewhere : body;
      resolve({ ok: true, task });
      await Promise.resolve();
      // Layout effects run after React removes the queue entry from the DOM.
      state.layouts.at(-1)!();
      expect(focus).toHaveBeenCalledTimes(movedElsewhere ? 0 : 1);
      expect(view.props.tabIndex).toBe(-1);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps queue progress and errors outside the busy message list during interruption', () => {
  state.error = 'Could not confirm this update. Check the task before trying again.';
  const task = { state: 'interrupting', queue: [{ id: 'queued-1', state: 'applying', message: { content: 'Follow up' } }] } as TaskSnapshot;
  const view = TaskQueue({ task, onRemove: vi.fn(), onInterrupt: vi.fn() })!;
  const announcements: Array<{ role: string; busy: boolean; text: unknown }> = [];
  const visit = (node: any, busy = false) => {
    if (!node?.props) return;
    busy = busy || node.props['aria-busy'] === true;
    if (node.props.role === 'status' || node.props.role === 'alert') {
      announcements.push({ role: node.props.role, busy, text: node.props.children });
    }
    const children = node.props.children;
    (Array.isArray(children) ? children.flat() : [children]).forEach((child) => visit(child, busy));
  };
  visit(view);
  expect(announcements).toEqual([
    { role: 'status', busy: false, text: 'Interrupting…' },
    { role: 'alert', busy: false, text: state.error },
  ]);
  expect(view.props.children[1].type).toBe('ul');
  expect(view.props.children[1].props['aria-busy']).toBe(true);
});
