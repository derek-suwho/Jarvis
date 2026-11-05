import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (update: unknown) => {
      hooks.values[index] = typeof update === 'function' ? update(hooks.values[index]) : update;
    }];
  },
}));
import { ScheduledView } from '../src/components/ScheduledView';

afterEach(() => { hooks.values = []; hooks.cursor = 0; });

it('keeps custom interval entry visible through 60 minutes and saves 600 minutes', () => {
  hooks.values = [{ kind: 'new', draft: { title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 30 } } }];
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(),
    onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  // Exercise the shipping editor with persistent hook state across renders.
  const editor = view.props.children[1].props.children[1];
  hooks.values = [];
  const onSave = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return editor.type({ ...editor.props, initial: { title: 'Review', prompt: 'Review updates',
      cadence: { kind: 'interval', minutes: 30 } }, onSave });
  };
  const row = (form: any) => form.props.children[3].props.children;
  const frequency = (form: any) => row(form)[0].props.children[1];
  const minutes = (form: any) => row(form)[3]?.props?.children[1];
  let form = render();
  expect(frequency(form).props.value).toBe('interval');
  minutes(form).props.onChange({ target: { value: '60' } });
  form = render();
  expect(frequency(form).props.value).toBe('interval');
  expect(minutes(form)?.props.value).toBe(60);
  minutes(form).props.onChange({ target: { value: '600' } });
  form = render();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenLastCalledWith({ title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 600 } });
  frequency(form).props.onChange({ target: { value: 'hourly' } });
  form = render();
  expect(frequency(form).props.value).toBe('hourly');
  expect(minutes(form)).toBeUndefined();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenLastCalledWith({ title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 60 } });
});

it('retains a fractional repeat interval for correction instead of silently saving a rounded cadence', () => {
  hooks.values = [{ kind: 'new', draft: { title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 30 } } }];
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(),
    onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  hooks.values = [];
  const onSave = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return editor.type({ ...editor.props, onSave });
  };
  const minutes = (form: any) => form.props.children[3].props.children[3].props.children[1];
  let form = render();
  minutes(form).props.onChange({ target: { value: '5.4' } });
  form = render();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  form = render();
  expect(minutes(form).props.value).toBe(5.4);
  expect(minutes(form).props['aria-invalid']).toBe(true);
  const alert = form.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.children).toBe('Repeat at least every 5 minutes.');
  expect(minutes(form).props['aria-describedby']).toBe(alert.props.id);
  minutes(form).props.onChange({ target: { value: '10' } });
  form = render();
  expect(minutes(form).props['aria-invalid']).toBeUndefined();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 10 } });
});

it('keeps a cleared repeat interval blank until the user enters a replacement', () => {
  hooks.values = [{ kind: 'new', draft: { title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 30 } } }];
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(),
    onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  hooks.values = [];
  const onSave = vi.fn();
  const render = () => { hooks.cursor = 0; return editor.type({ ...editor.props, onSave }); };
  const minutes = (form: any) => form.props.children[3].props.children[3].props.children[1];
  let form = render();
  minutes(form).props.onChange({ target: { value: '' } });
  form = render();
  expect(minutes(form).props.value).toBe('');
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  form = render();
  expect(minutes(form).props['aria-invalid']).toBe(true);
  minutes(form).props.onChange({ target: { value: '15' } });
  form = render();
  expect(minutes(form).props['aria-invalid']).toBeUndefined();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Review', prompt: 'Review updates', cadence: { kind: 'interval', minutes: 15 } });
});

it('preserves the schedule draft for modified Escape shortcuts and cancels with plain Escape', () => {
  hooks.values = [{ kind: 'new', draft: { title: 'Review', prompt: 'Review updates', cadence: { kind: 'daily', time: '09:00' } } }];
  const view = ScheduledView({ schedules: [], onCreate: vi.fn(), onUpdate: vi.fn(),
    onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() });
  const editor = view.props.children[1].props.children[1];
  hooks.values = [];
  hooks.cursor = 0;
  const onCancel = vi.fn();
  const onSave = vi.fn();
  const form = editor.type({ ...editor.props, onCancel, onSave });
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    const event = { key: 'Escape', [modifier]: true, nativeEvent: {}, preventDefault: vi.fn() };
    form.props.onKeyDown(event);
    expect(onCancel).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  const escape = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn() };
  form.props.onKeyDown(escape);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(escape.preventDefault).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
