import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ updates: [] as unknown[], detail: false, editing: false, armed: false, error: null as string | null, effects: [] as Array<() => void | (() => void)> }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: () => ({ current: null }),
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
  useState: (value: unknown) => [
    value && typeof value === 'object' && 'kind' in value && value.kind === 'home'
      ? state.editing ? { kind: 'edit', id: 'task' } : state.detail ? { kind: 'view', id: 'task' } : { kind: 'new', draft: { title: 'Briefing', prompt: 'Review updates', cadence: { kind: 'daily', time: '09:00' } } }
      : value === null ? state.error : value === false ? state.armed : value,
    (value: unknown) => state.updates.push(value),
  ],
}));
import { ScheduledView } from '../src/components/ScheduledView';

it('keeps IME confirmation from saving a schedule and preserves ordinary submission', () => {
  const onCreate = vi.fn(() => 'created');
  const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const form = editor.type(editor.props);
  for (const nativeEvent of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
    const event = { key: 'Enter', nativeEvent, preventDefault: vi.fn() };
    form.props.onKeyDown?.(event);
    if (!event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onCreate).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
  const enter = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  form.props.onKeyDown?.(enter);
  expect(enter.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onCreate).toHaveBeenCalledExactlyOnceWith({ title: 'Briefing', prompt: 'Review updates', cadence: { kind: 'daily', time: '09:00' } });
});

it('cancels an unsaved schedule with Escape while preserving IME and consumed keys', () => {
  const onCreate = vi.fn();
  const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onCancel = vi.fn();
  const form = editor.type({ ...editor.props, onCancel });
  for (const patch of [
    { nativeEvent: { isComposing: true } },
    { nativeEvent: { keyCode: 229 } },
    { defaultPrevented: true },
    { key: 'Tab' },
  ]) {
    const event = { key: 'Escape', defaultPrevented: false, nativeEvent: {}, preventDefault: vi.fn(), ...patch };
    form.props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  }
  const escape = { key: 'Escape', defaultPrevented: false, nativeEvent: {}, preventDefault: vi.fn() };
  form.props.onKeyDown(escape);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(escape.preventDefault).toHaveBeenCalledOnce();
  expect(onCreate).not.toHaveBeenCalled();
});


it('keeps a failed save editable, reports a safe error, and permits retry', () => {
  state.updates.length = 0;
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
  const onCancel = vi.fn();
  const form = editor.type({ ...editor.props, onSave, onCancel });
  expect(() => form.props.onSubmit({ preventDefault: vi.fn() })).not.toThrow();
  expect(state.updates).toContain('Unable to save this task. Your draft is still here. Try again.');
  expect(onCancel).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toEqual(editor.props.initial);
});

it('disarms schedule deletion with Escape while preserving composing and consumed keys', () => {
  state.detail = true;
  state.updates.length = 0;
  try {
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const section = detail.type(detail.props);
    const actions = section.props.children[4];
    const deleteButton = actions.props.children[4];
    deleteButton.props.onClick();
    expect(state.updates.pop()).toBe(true);
    for (const patch of [{ nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { defaultPrevented: true }]) {
      section.props.onKeyDown?.({ key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), ...patch });
      expect(state.updates).toEqual([]);
    }
    const event = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn() };
    section.props.onKeyDown?.(event);
    expect(state.updates).toEqual([false]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  } finally { state.detail = false; }
});

it('reports a failed manual schedule run safely and permits retry', () => {
  state.detail = true;
  state.updates.length = 0;
  try {
    const onRunNow = vi.fn().mockImplementationOnce(() => { throw new Error('private provider details'); });
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow, onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const section = detail.type(detail.props);
    const runButton = section.props.children[4].props.children[1];
    expect(() => runButton.props.onClick()).not.toThrow();
    expect(state.updates).toEqual(['Unable to start this task. Try again.']);
    state.error = state.updates[0] as string;
    const alert = detail.type(detail.props).props.children[5];
    expect(alert.props.role).toBe('alert');
    expect(alert.props.children).toBe('Unable to start this task. Try again.');
    runButton.props.onClick();
    expect(onRunNow).toHaveBeenCalledTimes(2);
    expect(onRunNow).toHaveBeenLastCalledWith('task');
    expect(state.updates).toEqual(['Unable to start this task. Try again.', null]);
  } finally { state.detail = false; state.error = null; }
});

it('reports failed pause and resume actions safely and permits retry', () => {
  state.detail = true;
  try {
    for (const paused of [false, true]) {
      state.updates.length = 0;
      state.error = null;
      const onPause = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused }],
        onCreate: vi.fn(), onUpdate: vi.fn(), onPause, onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const detail = view.props.children[1].props.children[1];
      const button = detail.type(detail.props).props.children[4].props.children[3];
      expect(() => button.props.onClick()).not.toThrow();
      expect(state.updates).toEqual(['Unable to change this task. Try again.']);
      state.error = state.updates[0] as string;
      const alert = detail.type(detail.props).props.children[5];
      expect(alert.props.role).toBe('alert');
      expect(alert.props.children).toBe('Unable to change this task. Try again.');
      button.props.onClick();
      expect(onPause).toHaveBeenCalledTimes(2);
      expect(onPause).toHaveBeenLastCalledWith('task', !paused);
      expect(state.updates).toEqual(['Unable to change this task. Try again.', ...(!paused ? [true] : []), null]);
    }
  } finally { state.detail = false; state.error = null; }
});

it('retains schedule detail after failed deletion and allows a safe retry', () => {
  state.detail = true;
  state.armed = true;
  state.updates.length = 0;
  try {
    const onDelete = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete, onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const button = detail.type(detail.props).props.children[4].props.children[4];
    expect(button.props.children).toBe('Confirm delete');
    expect(() => button.props.onClick()).not.toThrow();
    expect(state.updates).toEqual([false, 'Unable to delete this task. Try again.']);
    state.armed = false;
    state.error = state.updates[1] as string;
    const section = detail.type(detail.props);
    expect(section.props.children[5].props.role).toBe('alert');
    expect(section.props.children[5].props.children).toBe('Unable to delete this task. Try again.');
    expect(section.props.children[4].props.children[4].props.children).toBe('Delete');
    section.props.children[4].props.children[4].props.onClick();
    expect(onDelete).toHaveBeenCalledOnce();
    state.armed = true;
    detail.type(detail.props).props.children[4].props.children[4].props.onClick();
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(onDelete).toHaveBeenLastCalledWith('task');
    expect(state.updates).toEqual([false, 'Unable to delete this task. Try again.', true, { kind: 'home' }, null]);
  } finally { state.detail = false; state.armed = false; state.error = null; }
});

it('retries saving schedules from the persistence warning', () => {
  const onRetrySave = vi.fn();
  const view = ScheduledView({ schedules: [], persistenceFailed: true, onRetrySave,
    onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(),
    onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const warning = view.props.children[0].props.children.find((child: any) => child?.props?.role === 'alert');
  warning.props.children[1].props.onClick();
  expect(onRetrySave).toHaveBeenCalledOnce();
});

it('associates invalid instructions with their error without mislabeling save failures', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, prompt: '   ' }, onSave };
  state.updates.length = 0;
  try {
    editor.type(props).props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    state.error = state.updates[0] as string;
    const form = editor.type(props);
    const instructions = form.props.children[2].props.children[1];
    const alert = form.props.children[4];
    expect(instructions.props['aria-invalid']).toBe(true);
    expect(alert.props.role).toBe('alert');
    expect(alert.props.id).toBeTruthy();
    expect(instructions.props['aria-describedby'].split(' ')).toEqual(['schedule-instructions-help', alert.props.id]);
    state.error = 'Unable to save this task. Your draft is still here. Try again.';
    const valid = editor.type({ ...props, initial: editor.props.initial });
    expect(valid.props.children[2].props.children[1].props['aria-invalid']).toBeUndefined();
    state.error = null;
    const recovered = editor.type(props).props.children[2].props.children[1];
    expect(recovered.props['aria-invalid']).toBeUndefined();
    expect(recovered.props['aria-describedby']).toBe('schedule-instructions-help');
  } finally { state.error = null; }
});


it('focuses invalid instructions on submission and leaves valid submissions alone', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  for (const prompt of ['   ', 'x'.repeat(4001), 'Review updates']) {
    const onSave = vi.fn();
    const form = editor.type({ ...editor.props, initial: { ...editor.props.initial, prompt }, onSave });
    const instructions = form.props.children[2].props.children[1];
    const focus = vi.fn();
    expect(instructions.ref).toBeTruthy();
    instructions.ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(focus).toHaveBeenCalledTimes(prompt === 'Review updates' ? 0 : 1);
    expect(onSave).toHaveBeenCalledTimes(prompt === 'Review updates' ? 1 : 0);
  }
});

it('returns focus to New task when cancelling a new schedule with Escape or Cancel', () => {
  for (const action of ['Escape', 'Cancel']) {
    const onCreate = vi.fn();
    const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const newTask = view.props.children[0].props.children[1];
    const focus = vi.fn();
    expect(newTask.ref).toBeTruthy();
    newTask.ref.current = { focus };
    const editor = view.props.children[1].props.children[1];
    const form = editor.type(editor.props);
    if (action === 'Escape') {
      form.props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault: vi.fn() });
    } else {
      form.props.children[5].props.children[0].props.onClick({ defaultPrevented: false });
    }
    expect(focus).toHaveBeenCalledOnce();
    expect(state.updates.at(-1)).toEqual({ kind: 'home' });
    expect(onCreate).not.toHaveBeenCalled();
  }
});


it('returns focus to the selected schedule when cancelling an edit with Escape or Cancel', () => {
  state.editing = true;
  try {
    for (const action of ['Escape', 'Cancel']) {
      state.updates.length = 0;
      const onUpdate = vi.fn();
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
        onCreate: vi.fn(), onUpdate, onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const selectedTask = view.props.children[0].props.children[5][0];
      const focus = vi.fn();
      expect(selectedTask.props['aria-current']).toBe('true');
      expect(selectedTask.ref).toBeTruthy();
      selectedTask.ref.current = { focus };
      const editor = view.props.children[1].props.children[1];
      const form = editor.type(editor.props);
      if (action === 'Escape') {
        form.props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault: vi.fn() });
      } else {
        form.props.children[5].props.children[0].props.onClick({ defaultPrevented: false });
      }
      expect(focus).toHaveBeenCalledOnce();
      expect(state.updates.at(-1)).toEqual({ kind: 'view', id: 'task' });
      expect(onUpdate).not.toHaveBeenCalled();
    }
  } finally { state.editing = false; }
});

it('restores selected schedule focus only after an edit saves successfully', () => {
  state.editing = true;
  try {
    for (const fails of [false, true]) {
      state.updates.length = 0;
      const onUpdate = vi.fn(() => { if (fails) throw new Error('Unavailable'); });
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
        onCreate: vi.fn(), onUpdate, onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const selectedTask = view.props.children[0].props.children[5][0];
      const focus = vi.fn();
      selectedTask.ref.current = { focus };
      const editor = view.props.children[1].props.children[1];
      const form = editor.type(editor.props);
      form.props.onSubmit({ preventDefault: vi.fn() });
      expect(onUpdate).toHaveBeenCalledExactlyOnceWith('task', editor.props.initial);
      expect(focus).toHaveBeenCalledTimes(fails ? 0 : 1);
      if (fails) {
        expect(state.updates).not.toContainEqual({ kind: 'view', id: 'task' });
        expect(state.updates.at(-1)).toBe('Unable to save this task. Your draft is still here. Try again.');
      } else {
        expect(state.updates).toContainEqual({ kind: 'view', id: 'task' });
      }
    }
  } finally { state.editing = false; }
});

it('returns focus to New task only after the selected schedule is deleted successfully', () => {
  state.detail = true;
  state.armed = true;
  try {
    for (const fails of [false, true]) {
      state.updates.length = 0;
      const focus = vi.fn();
      const onDelete = vi.fn(() => {
        expect(focus).not.toHaveBeenCalled();
        if (fails) throw new Error('Unavailable');
      });
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
        onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete, onRunNow: vi.fn(), onOpenChat: vi.fn() });
      view.props.children[0].props.children[1].ref.current = { focus };
      const detail = view.props.children[1].props.children[1];
      const button = detail.type(detail.props).props.children[4].props.children[4];
      button.props.onClick();
      expect(onDelete).toHaveBeenCalledExactlyOnceWith('task');
      expect(focus).toHaveBeenCalledTimes(fails ? 0 : 1);
      if (fails) {
        expect(state.updates).not.toContainEqual({ kind: 'home' });
        expect(state.updates.at(-1)).toBe('Unable to delete this task. Try again.');
      } else {
        expect(state.updates).toContainEqual({ kind: 'home' });
      }
    }
  } finally { state.detail = false; state.armed = false; }
});

it('starts new and existing schedule editors at the Name field without competing autofocus', () => {
  for (const editing of [false, true]) {
    state.editing = editing;
    try {
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
        onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const editor = view.props.children[1].props.children[1];
      const form = editor.type(editor.props);
      const name = form.props.children[1].props.children[1];
      const instructions = form.props.children[2].props.children[1];
      expect(name.props.autoFocus).toBe(true);
      expect(instructions.props.autoFocus).toBeFalsy();
    } finally { state.editing = false; }
  }
});

it('returns focus to New task only after creating a schedule successfully', () => {
  for (const fails of [false, true]) {
    state.updates.length = 0;
    const focus = vi.fn();
    const onCreate = vi.fn(() => {
      expect(focus).not.toHaveBeenCalled();
      if (fails) throw new Error('Unavailable');
      return 'created';
    });
    const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    view.props.children[0].props.children[1].ref.current = { focus };
    const editor = view.props.children[1].props.children[1];
    const form = editor.type(editor.props);
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(editor.props.initial);
    expect(focus).toHaveBeenCalledTimes(fails ? 0 : 1);
    if (fails) {
      expect(state.updates).not.toContainEqual({ kind: 'view', id: 'created' });
      expect(state.updates.at(-1)).toBe('Unable to save this task. Your draft is still here. Try again.');
    } else {
      expect(state.updates).toContainEqual({ kind: 'view', id: 'created' });
    }
  }
});

it('focuses a missing schedule time and associates its validation error with the field', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'daily', time: '' } }, onSave };
  const focus = vi.fn();
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const time = form.props.children[3].props.children[2].props.children[1];
    if (time.ref) time.ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    state.error = state.updates[0] as string;
    const invalidForm = editor.type(props);
    const invalidTime = invalidForm.props.children[3].props.children[2].props.children[1];
    expect(invalidTime.props['aria-invalid']).toBe(true);
    expect(invalidTime.props['aria-describedby']).toBe(invalidForm.props.children[4].props.id);
    expect(invalidForm.props.children[2].props.children[1].props['aria-invalid']).toBeUndefined();
    state.error = 'Unable to save this task. Your draft is still here. Try again.';
    const validForm = editor.type(editor.props);
    expect(validForm.props.children[3].props.children[2].props.children[1].props['aria-invalid']).toBeUndefined();
  } finally { state.error = null; }
});

it('focuses a past one-time schedule date and associates its validation error', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'once', at: Date.now() - 60_000 } }, onSave };
  const focus = vi.fn();
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const when = form.props.children[3].props.children[4].props.children[1];
    if (when.ref) when.ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    state.error = state.updates[0] as string;
    const invalidForm = editor.type(props);
    const invalidWhen = invalidForm.props.children[3].props.children[4].props.children[1];
    expect(invalidWhen.props['aria-invalid']).toBe(true);
    expect(invalidWhen.props['aria-describedby']).toBe(invalidForm.props.children[4].props.id);
    expect(invalidForm.props.children[4].props.children).toBe('Pick a time in the future.');
    state.error = 'Unable to save this task. Your draft is still here. Try again.';
    const validForm = editor.type({ ...props, initial: { ...props.initial, cadence: { kind: 'once', at: Date.now() + 3600_000 } } });
    const validWhen = validForm.props.children[3].props.children[4].props.children[1];
    expect(validWhen.props['aria-invalid']).toBeUndefined();
    expect(validWhen.props['aria-describedby']).toBeUndefined();
  } finally { state.error = null; }
});

it('focuses an invalid repeat interval and associates its validation error', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'interval', minutes: 0 } }, onSave };
  const focus = vi.fn();
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const minutes = form.props.children[3].props.children[3].props.children[1];
    if (minutes.ref) minutes.ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    state.error = state.updates[0] as string;
    const invalidForm = editor.type(props);
    const invalidMinutes = invalidForm.props.children[3].props.children[3].props.children[1];
    expect(invalidMinutes.props['aria-invalid']).toBe(true);
    expect(invalidMinutes.props['aria-describedby']).toBe(invalidForm.props.children[4].props.id);
    expect(invalidForm.props.children[2].props.children[1].props['aria-invalid']).toBeUndefined();
    state.error = 'Unable to save this task. Your draft is still here. Try again.';
    const validProps = { ...props, initial: { ...props.initial, cadence: { kind: 'interval', minutes: 30 } } };
    const validForm = editor.type(validProps);
    const validMinutes = validForm.props.children[3].props.children[3].props.children[1];
    expect(validMinutes.props['aria-invalid']).toBeUndefined();
    expect(validMinutes.props['aria-describedby']).toBeUndefined();
    validForm.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(validProps.initial);
  } finally { state.error = null; }
});

it('lets application validation recover invalid intervals instead of browser-blocking submission', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'interval', minutes: 0 } }, onSave };
  const form = editor.type(props);
  // A number input below its min otherwise prevents the browser from emitting submit.
  expect(form.props.noValidate).toBe(true);
  const focus = vi.fn();
  form.props.children[3].props.children[3].props.children[1].ref.current = { focus };
  state.updates.length = 0;
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  expect(state.updates).toEqual(['Repeat at least every 5 minutes.']);
});

it('reveals paused tasks after successfully pausing the selected task, but not on failure or resume', () => {
  state.detail = true;
  try {
    for (const [paused, fails] of [[false, false], [false, true], [true, false]]) {
      state.updates.length = 0;
      const onPause = vi.fn(() => { if (fails) throw new Error('Unavailable'); });
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused }],
        onCreate: vi.fn(), onUpdate: vi.fn(), onPause, onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const detail = view.props.children[1].props.children[1];
      detail.type(detail.props).props.children[4].props.children[3].props.onClick();
      expect(onPause).toHaveBeenCalledExactlyOnceWith('task', !paused);
      expect(state.updates.includes(true)).toBe(!paused && !fails);
      expect(state.updates).not.toContainEqual({ kind: 'home' });
    }
  } finally { state.detail = false; }
});

it('preserves schedule detail and offers a safe retry when opening its conversation fails', () => {
  state.detail = true;
  state.updates.length = 0;
  try {
    const onOpenChat = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false, chatId: 'chat' }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat });
    const detail = view.props.children[1].props.children[1];
    const button = detail.type(detail.props).props.children[4].props.children[0];
    expect(() => button.props.onClick()).not.toThrow();
    expect(state.updates).toEqual(['Unable to open this conversation. Try again.']);
    state.error = state.updates[0] as string;
    const failed = detail.type(detail.props);
    expect(failed.props.children[5].props.role).toBe('alert');
    expect(failed.props.children[5].props.children).toBe('Unable to open this conversation. Try again.');
    failed.props.children[4].props.children[0].props.onClick();
    expect(onOpenChat).toHaveBeenCalledTimes(2);
    expect(onOpenChat).toHaveBeenNthCalledWith(1, 'chat');
    expect(onOpenChat).toHaveBeenNthCalledWith(2, 'chat');
    expect(state.updates).toEqual(['Unable to open this conversation. Try again.', null]);
    state.error = null;
    expect(detail.type(detail.props).props.children[5]).toBeNull();
  } finally { state.detail = false; state.error = null; }
});

it('explains the maximum repeat interval, focuses it, and accepts a corrected interval', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'interval', minutes: 10081 } }, onSave };
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const focus = vi.fn();
    form.props.children[3].props.children[3].props.children[1].ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    expect(state.updates).toEqual(['Repeat interval must be 10080 minutes (7 days) or less.']);
    state.error = state.updates[0] as string;
    const invalid = editor.type(props);
    const minutes = invalid.props.children[3].props.children[3].props.children[1];
    expect(minutes.props['aria-invalid']).toBe(true);
    expect(minutes.props['aria-describedby']).toBe(invalid.props.children[4].props.id);
    const corrected = { ...props, initial: { ...props.initial, cadence: { kind: 'interval', minutes: 10080 } } };
    const valid = editor.type(corrected);
    expect(valid.props.children[3].props.children[3].props.children[1].props['aria-invalid']).toBeUndefined();
    valid.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(corrected.initial);
  } finally { state.error = null; }
});

it('does not retry a failed schedule save from held Enter and preserves instruction newlines', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn().mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  const form = editor.type({ ...editor.props, onSave });
  const press = (repeat: boolean, tagName = 'INPUT') => {
    const event = { key: 'Enter', repeat, target: { tagName }, nativeEvent: {}, preventDefault: vi.fn() };
    form.props.onKeyDown(event);
    // Model implicit form submission from a single-line field, or newline insertion in Instructions.
    if (tagName === 'INPUT' && !event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
    return event;
  };
  press(false);
  expect(onSave).toHaveBeenCalledOnce();
  expect(press(true).preventDefault).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
  expect(press(true, 'TEXTAREA').preventDefault).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledOnce();
  press(false);
  expect(onSave).toHaveBeenCalledTimes(2);
});


it('requires fresh schedule deletion confirmation after the application window loses focus', () => {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string, listener: () => void) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  });
  state.detail = true;
  state.armed = true;
  state.effects.length = 0;
  state.updates.length = 0;
  const onDelete = vi.fn();
  const cleanups: Array<void | (() => void)> = [];
  try {
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete, onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const button = () => detail.type(detail.props).props.children[4].props.children[4];
    expect(button().props.children).toBe('Confirm delete');
    state.effects.forEach((effect) => cleanups.push(effect()));
    expect(listeners.has('blur')).toBe(true);
    listeners.get('blur')!();
    expect(state.updates).toEqual([false]);
    state.armed = state.updates.pop() as boolean;
    expect(button().props.children).toBe('Delete');
    button().props.onClick();
    expect(onDelete).not.toHaveBeenCalled();
    state.armed = state.updates.pop() as boolean;
    expect(button().props.children).toBe('Confirm delete');
    button().props.onClick();
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('task');
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    state.detail = false;
    state.armed = false;
    state.effects.length = 0;
    state.updates.length = 0;
    vi.unstubAllGlobals();
  }
  expect(listeners.size).toBe(0);
});

it('keeps a cleared one-time date empty and editable until a valid future date is supplied', () => {
  state.updates.length = 0;
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const render = (at: number) => editor.type({ ...editor.props, onSave,
    initial: { ...editor.props.initial, cadence: { kind: 'once', at } } });
  const when = (form: any) => form.props.children[3].props.children[4].props.children[1];
  const initial = render(Date.now() + 3600_000);
  when(initial).props.onChange({ target: { value: '' } });
  const update = state.updates.find((value) => typeof value === 'function') as (draft: any) => any;
  const cleared = update(editor.props.initial);
  expect(Number.isNaN(cleared.cadence.at)).toBe(true);
  const empty = render(cleared.cadence.at);
  expect(when(empty).props.value).toBe('');
  empty.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  expect(state.updates).toContain('Pick a time in the future.');
  const future = Date.now() + 7200_000;
  const recovered = render(future);
  expect(when(recovered).props.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  recovered.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...editor.props.initial, cadence: { kind: 'once', at: future } });
});

it('preserves an unsaved schedule when Escape is held and cancels only on a fresh press', () => {
  const onCreate = vi.fn();
  const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onCancel = vi.fn();
  const form = editor.type({ ...editor.props, onCancel });
  const press = (repeat: boolean) => {
    const event = { key: 'Escape', repeat, nativeEvent: {}, preventDefault: vi.fn() };
    form.props.onKeyDown(event);
    return event;
  };
  press(true);
  expect(onCancel).not.toHaveBeenCalled();
  expect(form.props.children[2].props.children[1].props.value).toBe('Review updates');
  expect(press(false).preventDefault).toHaveBeenCalledOnce();
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onCreate).not.toHaveBeenCalled();
});

it('requires a fresh Enter to confirm schedule deletion after keyboard arming', () => {
  state.detail = true;
  state.armed = false;
  state.updates.length = 0;
  const onDelete = vi.fn();
  try {
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete, onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const button = () => detail.type(detail.props).props.children[4].props.children[4];
    const press = (repeat: boolean, nativeEvent = {}) => {
      const event = { key: 'Enter', repeat, nativeEvent, preventDefault: vi.fn() };
      const current = button();
      current.props.onKeyDown?.(event);
      // Uncancelled Enter activates a focused native button.
      if (!event.preventDefault.mock.calls.length) current.props.onClick();
      return event;
    };
    press(false);
    expect(onDelete).not.toHaveBeenCalled();
    state.armed = state.updates.pop() as boolean;
    expect(button().props.children).toBe('Confirm delete');
    expect(press(true).preventDefault).toHaveBeenCalledOnce();
    expect(press(false, { isComposing: true }).preventDefault).toHaveBeenCalledOnce();
    expect(press(false, { keyCode: 229 }).preventDefault).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
    press(false);
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('task');
  } finally {
    state.detail = false;
    state.armed = false;
    state.updates.length = 0;
  }
});

it('keeps the local time-zone disclosure available while creating or editing a schedule', () => {
  for (const editing of [false, true]) {
    state.editing = editing;
    try {
      const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
        cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
        onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const note = view.props.children[0].props.children.find((child: any) => child?.props?.className === 'schedule-note');
      expect(note.props.children).toContain('Schedule times use your computer’s local time zone.');
      const editor = view.props.children[1].props.children[1];
      expect(editor.props.heading).toBe(editing ? 'Edit task' : 'New task');
    } finally { state.editing = false; }
  }
});

it('requires fresh confirmation after a schedule deletion fails', () => {
  state.detail = true;
  state.armed = true;
  state.updates.length = 0;
  const onDelete = vi.fn(() => { throw new Error('private storage details'); });
  try {
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete,
      onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const render = () => detail.type(detail.props);
    const deletion = () => render().props.children[4].props.children[4];
    deletion().props.onClick();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(state.updates).toContain('Unable to delete this task. Try again.');
    expect(state.updates).toContain(false);
    // Apply the recorded confirmation-state update and retry from the retained detail.
    state.armed = false;
    state.updates.length = 0;
    expect(deletion().props.children).toBe('Delete');
    deletion().props.onClick();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(state.updates).toContain(true);
  } finally {
    state.detail = false;
    state.armed = false;
    state.updates.length = 0;
  }
});

it('saves schedule instructions with Cmd/Ctrl+Enter without consuming multiline entry or unsafe shortcuts', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const form = editor.type({ ...editor.props, onSave });
  const key = (patch: object = {}) => ({ key: 'Enter', metaKey: false, ctrlKey: false,
    altKey: false, shiftKey: false, repeat: false, defaultPrevented: false,
    target: { tagName: 'TEXTAREA' }, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch });
  for (const patch of [{}, { metaKey: true, repeat: true }, { ctrlKey: true, defaultPrevented: true },
    { metaKey: true, nativeEvent: { isComposing: true } }, { ctrlKey: true, nativeEvent: { keyCode: 229 } },
    { metaKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }]) {
    form.props.onKeyDown(key(patch));
    expect(onSave).not.toHaveBeenCalled();
  }
  const newline = key();
  form.props.onKeyDown(newline);
  expect(newline.preventDefault).not.toHaveBeenCalled();
  for (const patch of [{ metaKey: true }, { ctrlKey: true }]) {
    const event = key(patch);
    form.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  }
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith(editor.props.initial);
});

it('requires a fresh key press to launch a scheduled task instead of launching runs while Enter is held', () => {
  state.detail = true;
  try {
    const onRunNow = vi.fn();
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow, onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const section = detail.type(detail.props);
    const run = section.props.children[4].props.children[1];
    const press = (repeat: boolean) => {
      const event = { key: 'Enter', repeat, nativeEvent: {}, preventDefault: vi.fn() };
      run.props.onKeyDown?.(event);
      // An uncancelled Enter activates a focused native button.
      if (!event.preventDefault.mock.calls.length) run.props.onClick();
      return event;
    };
    press(false);
    expect(onRunNow).toHaveBeenCalledExactlyOnceWith('task');
    expect(press(true).preventDefault).toHaveBeenCalledOnce();
    expect(onRunNow).toHaveBeenCalledOnce();
    press(false);
    expect(onRunNow).toHaveBeenCalledTimes(2);
    run.props.onClick();
    expect(onRunNow).toHaveBeenCalledTimes(3);
  } finally {
    state.detail = false;
  }
});

it('keeps a held Enter from undoing a schedule pause after the detail updates', () => {
  state.detail = true;
  try {
    let schedule = { id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily' as const, time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false };
    const onPause = vi.fn((_id: string, paused: boolean) => { schedule = { ...schedule, paused }; });
    const render = () => {
      const view = ScheduledView({ schedules: [schedule], onCreate: vi.fn(), onUpdate: vi.fn(),
        onPause, onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
      const detail = view.props.children[1].props.children[1];
      return detail.type(detail.props).props.children[4].props.children[3];
    };
    const press = (repeat: boolean) => {
      const button = render();
      const event = { key: 'Enter', repeat, nativeEvent: {}, preventDefault: vi.fn() };
      button.props.onKeyDown?.(event);
      if (!event.preventDefault.mock.calls.length) button.props.onClick();
      return event;
    };
    press(false);
    expect(schedule.paused).toBe(true);
    expect(render().props.children).toBe('Resume');
    expect(press(true).preventDefault).toHaveBeenCalledOnce();
    expect(schedule.paused).toBe(true);
    expect(onPause).toHaveBeenCalledExactlyOnceWith('task', true);
    press(false);
    expect(schedule.paused).toBe(false);
    render().props.onClick();
    expect(schedule.paused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(3);
  } finally {
    state.detail = false;
  }
});

it('moves keyboard focus to the selected schedule heading when its detail opens', () => {
  state.detail = true;
  state.effects.length = 0;
  try {
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const section = detail.type(detail.props);
    const heading = section.props.children[0];
    const focus = vi.fn();
    const ref = (heading as any).ref;
    if (ref) ref.current = { focus };
    const cleanup = state.effects.map((effect) => effect());
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(heading.props.tabIndex).toBe(-1);
    expect(heading.props.id).toBe(section.props['aria-labelledby']);
    expect(heading.props.children).toBe('Briefing');
    cleanup.forEach((dispose) => dispose?.());
  } finally { state.detail = false; state.effects.length = 0; }
});

it('associates schedule action failures with the controls and clears their descriptions after a successful retry', () => {
  state.detail = true;
  state.error = null;
  state.updates.length = 0;
  try {
    const onRunNow = vi.fn().mockImplementationOnce(() => { throw new Error('private provider details'); });
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false, chatId: 'chat' }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow, onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const render = () => detail.type(detail.props);
    const controls = (section: any) => section.props.children[4].props.children;
    expect(controls(render()).every((button: any) => button.props['aria-describedby'] === undefined)).toBe(true);
    controls(render())[1].props.onClick();
    state.error = state.updates.at(-1) as string;
    const failed = render();
    const alert = failed.props.children[5];
    expect(alert.props.role).toBe('alert');
    expect(alert.props.children).toBe('Unable to start this task. Try again.');
    expect(alert.props.id).toBeTruthy();
    for (const button of controls(failed)) expect(button.props['aria-describedby']).toBe(alert.props.id);
    controls(failed)[1].props.onClick();
    expect(onRunNow).toHaveBeenCalledTimes(2);
    state.error = state.updates.at(-1) as null;
    const recovered = render();
    expect(recovered.props.children[5]).toBeNull();
    expect(controls(recovered).every((button: any) => button.props['aria-describedby'] === undefined)).toBe(true);
  } finally { state.detail = false; state.error = null; state.updates.length = 0; }
});

it('describes a failed schedule save from the Save button and clears the description after retry', () => {
  state.error = null;
  state.updates.length = 0;
  try {
    const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const editor = view.props.children[1].props.children[1];
    const onSave = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
    const render = () => editor.type({ ...editor.props, onSave });
    const save = (form: any) => form.props.children[5].props.children[1];
    expect(save(render()).props['aria-describedby']).toBeUndefined();
    render().props.onSubmit({ preventDefault: vi.fn() });
    state.error = state.updates.at(-1) as string;
    const failed = render();
    const alert = failed.props.children[4];
    expect(alert.props.role).toBe('alert');
    expect(alert.props.children).toBe('Unable to save this task. Your draft is still here. Try again.');
    expect(save(failed).props['aria-describedby']).toBe(alert.props.id);
    failed.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).toHaveBeenCalledTimes(2);
    state.error = state.updates.at(-1) as null;
    expect(render().props.children[4]).toBeNull();
    expect(save(render()).props['aria-describedby']).toBeUndefined();
  } finally { state.error = null; state.updates.length = 0; }
});

it('names the schedule editor form from its visible new or edit heading', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  for (const heading of ['New task', 'Edit task']) {
    const form = editor.type({ ...editor.props, heading });
    const title = form.props.children[0];
    expect(form.props['aria-labelledby']).toBe('schedule-editor-title');
    expect(title.props.id).toBe(form.props['aria-labelledby']);
    expect(title.props.children).toBe(heading);
  }
});

it('identifies the device time zone in the schedule editor before a task is saved', () => {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  const zone = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ ...options, timeZone: 'America/New_York' });
  try {
    const onCreate = vi.fn();
    const view = ScheduledView({ schedules: [], onCreate, onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const editor = view.props.children[1].props.children[1];
    const form = editor.type(editor.props);
    const description = form.props.children.find((child: any) => child?.props?.id === form.props['aria-describedby']);
    expect(form.props['aria-describedby']).toBeTruthy();
    expect(description?.props.children).toBe('Times use your device’s local time zone (America/New_York).');
    expect(onCreate).not.toHaveBeenCalled();
  } finally { zone.mockRestore(); }
});

it('announces schedule deletion confirmation and cancellation guidance before deleting', () => {
  state.detail = true;
  state.armed = false;
  state.updates.length = 0;
  try {
    const onDelete = vi.fn();
    const view = ScheduledView({ schedules: [{ id: 'task', title: 'Briefing', prompt: 'Review updates',
      cadence: { kind: 'daily', time: '09:00' }, createdAt: 1, nextRunAt: 2, paused: false }],
      onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(), onDelete, onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const detail = view.props.children[1].props.children[1];
    const render = () => detail.type(detail.props);
    const status = (section: any) => section.props.children.find((child: any) => child?.props?.role === 'status');
    expect(status(render())?.props.children).toBe('');
    render().props.children[4].props.children[4].props.onClick();
    expect(onDelete).not.toHaveBeenCalled();
    state.armed = state.updates.pop() as boolean;
    const armed = render();
    expect(status(armed).props.children).toBe('Activate Confirm delete to delete this scheduled task. Press Escape or move focus away to cancel.');
    expect(status(armed).props['aria-atomic']).toBe(true);
    expect(status(armed).props.id).toBeTruthy();
    expect(armed.props.children[4].props.children[4].props['aria-describedby']).toBe(status(armed).props.id);
    armed.props.children[4].props.children[4].props.onBlur();
    state.armed = state.updates.pop() as boolean;
    expect(status(render()).props.children).toBe('');
    expect(render().props.children[4].props.children[4].props['aria-describedby']).toBeUndefined();
    expect(onDelete).not.toHaveBeenCalled();
  } finally { state.detail = false; state.armed = false; state.updates.length = 0; }
});

it('discloses schedule editor save and cancel shortcuts alongside instruction validation feedback', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  try {
    for (const error of [null, 'Write instructions for this task.']) {
      state.error = error;
      const form = editor.type({ ...editor.props, initial: { ...editor.props.initial, prompt: '' } });
      const field = form.props.children[2];
      const input = field.props.children[1];
      const help = field.props.children[2];
      expect(help?.props.children).toBe('Press ⌘Enter or Ctrl+Enter to save. Press Escape to cancel without saving.');
      expect(help.props.id).toBe('schedule-instructions-help');
      expect(input.props['aria-labelledby']).toBe(field.props.children[0].props.id);
      expect(input.props['aria-describedby'].split(' ')).toEqual(error
        ? [help.props.id, 'schedule-instructions-error'] : [help.props.id]);
      const save = form.props.children[5].props.children[1];
      expect(save.props['aria-keyshortcuts']).toBe('Meta+Enter Control+Enter');
    }
  } finally { state.error = null; }
});

it('preserves a schedule draft when modified Enter would implicitly submit from Name or Save', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const form = editor.type({ ...editor.props, onSave });
  for (const tagName of ['INPUT', 'BUTTON']) {
    for (const patch of [{ altKey: true }, { shiftKey: true }, { metaKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }]) {
      const event = { key: 'Enter', target: { tagName }, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch };
      form.props.onKeyDown(event);
      // Model the browser's default implicit submission / Save activation.
      if (!event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
      expect(onSave).not.toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  }
  const enter = { key: 'Enter', target: { tagName: 'INPUT' }, nativeEvent: {}, preventDefault: vi.fn() };
  form.props.onKeyDown(enter);
  expect(enter.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith(editor.props.initial);
});

it('preserves a schedule draft and feedback when submission has already been cancelled', () => {
  state.updates.length = 0;
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const form = editor.type({ ...editor.props, onSave, onCancel });
  const event = { defaultPrevented: true, preventDefault: vi.fn() };
  form.props.onSubmit(event);
  expect(onSave).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(state.updates).toEqual([]);
  expect(event.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ defaultPrevented: false, preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith(editor.props.initial);
});

it('focuses an invalid weekly day, associates its error, and accepts correction', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn();
  const props = { ...editor.props, initial: { ...editor.props.initial, cadence: { kind: 'weekly', day: 7, time: '09:00' } }, onSave };
  const dayField = (form: any) => form.props.children[3].props.children[1].props.children[1];
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const focus = vi.fn();
    if (dayField(form).ref) dayField(form).ref.current = { focus };
    form.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    state.error = state.updates[0] as string;
    const invalid = editor.type(props);
    expect(invalid.props.children[4].props.children).toBe('Pick a day.');
    expect(dayField(invalid).props['aria-invalid']).toBe(true);
    expect(dayField(invalid).props['aria-describedby']).toBe(invalid.props.children[4].props.id);
    state.updates.length = 0;
    dayField(invalid).props.onChange({ target: { value: '1' } });
    const correctedDraft = (state.updates[0] as Function)(props.initial);
    expect(state.updates[1]).toBeNull();
    state.error = null;
    const corrected = editor.type({ ...props, initial: correctedDraft });
    expect(dayField(corrected).props['aria-invalid']).toBeUndefined();
    expect(dayField(corrected).props['aria-describedby']).toBeUndefined();
    corrected.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(correctedDraft);
  } finally { state.error = null; }
});

it('returns focus to retained instructions and describes the save failure for keyboard retry', () => {
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
    onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  const onSave = vi.fn().mockImplementationOnce(() => { throw new Error('private storage detail'); });
  const props = { ...editor.props, onSave };
  const instructions = (form: any) => form.props.children[2].props.children[1];
  state.updates.length = 0;
  try {
    const form = editor.type(props);
    const focus = vi.fn();
    instructions(form).ref.current = { focus };
    form.props.onKeyDown({ key: 'Enter', ctrlKey: true, target: { tagName: 'INPUT' }, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(focus).toHaveBeenCalledOnce();
    state.error = state.updates[0] as string;
    const failed = editor.type(props);
    expect(instructions(failed).props.value).toBe(props.initial.prompt);
    expect(instructions(failed).props['aria-invalid']).toBeUndefined();
    expect(instructions(failed).props['aria-describedby'].split(' ')).toContain(failed.props.children[4].props.id);
    expect(failed.props.children[4].props.children).toBe('Unable to save this task. Your draft is still here. Try again.');
    failed.props.onSubmit({ preventDefault: vi.fn() });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(props.initial);
    expect(state.updates.at(-1)).toBeNull();
  } finally { state.error = null; }
});

it('retains a schedule draft and save feedback when a Cancel click was consumed', () => {
  const previousError = state.error;
  state.error = 'Unable to save this task. Your draft is still here. Try again.';
  state.updates.length = 0;
  try {
    const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
    const editor = view.props.children[1].props.children[1];
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const form = editor.type({ ...editor.props, onCancel, onSave });
    const actions = form.props.children.find((child: any) => child?.props?.className === 'schedule-actions');
    const cancel = actions.props.children[0];
    cancel.props.onClick({ defaultPrevented: true });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
    expect(form.props.children[2].props.children[1].props.value).toBe(editor.props.initial.prompt);
    expect(form.props.children.find((child: any) => child?.props?.role === 'alert')?.props.children).toBe(state.error);
    cancel.props.onClick({ defaultPrevented: false });
    expect(onCancel).toHaveBeenCalledOnce();
  } finally {
    state.error = previousError;
    state.updates.length = 0;
  }
});
