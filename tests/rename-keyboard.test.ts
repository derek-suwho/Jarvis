import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: '', setError: vi.fn(), nextId: 0 }));
afterEach(() => { state.error = ''; vi.clearAllMocks(); });

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => value === '' ? [state.error, state.setError] : [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useId: () => `rename-${++state.nextId}`,
}));
vi.mock('../src/components/useDialog', () => ({ useDialog: vi.fn() }));
import { RenameDialog } from '../src/components/RenameDialog';

it('prevents IME confirmation Enter from submitting a rename while preserving ordinary Enter', () => {
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Draft name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  const composing = { key: 'Enter', nativeEvent: { isComposing: true }, preventDefault: vi.fn() };
  input.props.onKeyDown?.(composing);
  expect(composing.preventDefault).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  const enter = { key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn() };
  input.props.onKeyDown?.(enter);
  expect(enter.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Draft name');
});

it('prevents legacy IME confirmation from implicitly submitting a rename', () => {
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename project', initialValue: 'Draft name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  const confirmation = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 229 }, preventDefault: vi.fn() };
  input.props.onKeyDown(confirmation);
  // The browser implicitly submits the form unless keydown cancels its default action.
  if (confirmation.preventDefault.mock.calls.length === 0) form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  expect(confirmation.preventDefault).toHaveBeenCalledOnce();
  const enter = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  input.props.onKeyDown(enter);
  expect(enter.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Draft name');
});


it('keeps a failed rename open with a safe error and permits a successful retry', () => {
  const onClose = vi.fn();
  const onSave = vi.fn().mockImplementationOnce(() => { throw new Error('private storage detail'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => RenameDialog({ title: 'Rename chat', initialValue: 'Draft name', onClose, onSave });
  const form = (view: any) => view.props.children.props.children[1];
  expect(() => form(render()).props.onSubmit({ preventDefault: vi.fn() })).not.toThrow();
  expect(onClose).not.toHaveBeenCalled();
  const failed = form(render());
  expect(failed.props.children[1].props.value).toBe('Draft name');
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not rename. Your name is still here. Try again.');
  expect(alert?.props.id).toBeTruthy();
  expect(failed.props.children[1].props['aria-describedby']).toBe(alert.props.id);
  form(render()).props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith('Draft name');
  expect(form(render()).props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(form(render()).props.children[1].props['aria-describedby']).toBeUndefined();
});

it('returns focus to Name for correction when saving a rename fails', () => {
  const onSave = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Keep this name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  const focus = vi.fn();
  if (input.ref) input.ref.current = { focus };
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Keep this name');
  expect(focus).toHaveBeenCalledOnce();
  expect(input.props.value).toBe('Keep this name');
});


it('keeps simultaneous rename dialogs independently labelled and their errors associated with their own inputs', () => {
  state.error = 'Could not rename. Your name is still here. Try again.';
  const render = (title: string) => RenameDialog({ title, initialValue: 'Draft', onClose: vi.fn(), onSave: vi.fn() }).props.children;
  const first = render('Rename chat');
  const second = render('Rename project');
  const ids = (dialog: any) => {
    const heading = dialog.props.children[0].props.children[0];
    const form = dialog.props.children[1];
    const label = form.props.children[0];
    const input = form.props.children[1];
    const alert = form.props.children.find((child: any) => child?.props?.role === 'alert');
    expect(dialog.props['aria-labelledby']).toBe(heading.props.id);
    expect(label.props.htmlFor).toBe(input.props.id);
    expect(input.props['aria-describedby']).toBe(alert.props.id);
    return [heading.props.id, input.props.id, alert.props.id];
  };
  const allIds = [...ids(first), ...ids(second)];
  expect(new Set(allIds).size).toBe(6);
});

it('prevents held Enter from repeatedly saving a rename while allowing a fresh Enter', () => {
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Draft name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  const press = (repeat: boolean) => {
    const event = { key: 'Enter', repeat, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    // Model the browser's implicit form submission for uncancelled Enter.
    if (!event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
    return event;
  };
  press(false);
  expect(onSave).toHaveBeenCalledOnce();
  expect(press(true).preventDefault).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
  press(false);
  expect(onSave).toHaveBeenCalledTimes(2);
});

it('clears stale rename failure feedback when the user edits the name without saving again', () => {
  const onSave = vi.fn(() => { throw new Error('Storage unavailable'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => RenameDialog({ title: 'Rename chat', initialValue: 'Draft', onClose: vi.fn(), onSave });
  const form = () => render().props.children.props.children[1];
  form().props.onSubmit({ preventDefault: vi.fn() });
  expect(form().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(true);
  form().props.children[1].props.onChange({ target: { value: 'Corrected name' } });
  expect(form().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(form().props.children[1].props['aria-describedby']).toBeUndefined();
  expect(onSave).toHaveBeenCalledOnce();
});

it('requires a fresh non-composing Enter to retry a failed rename from the Save button', () => {
  const onSave = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Draft name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const press = (repeat: boolean, isComposing = false, keyCode = 13) => {
    const event = { key: 'Enter', repeat, nativeEvent: { isComposing, keyCode }, preventDefault: vi.fn() };
    // Enter on Save bubbles to the form before the browser activates the button.
    form.props.onKeyDown?.(event);
    if (!event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
    return event;
  };
  press(false);
  expect(onSave).toHaveBeenCalledOnce();
  expect(press(true).preventDefault).toHaveBeenCalledOnce();
  expect(press(false, true).preventDefault).toHaveBeenCalledOnce();
  expect(press(false, false, 229).preventDefault).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
  press(false);
  expect(onSave).toHaveBeenCalledTimes(2);
});

it('associates a rename storage failure without marking the valid retained name invalid', () => {
  const onSave = vi.fn(() => { throw new Error('Storage unavailable'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const form = () => RenameDialog({ title: 'Rename project', initialValue: 'Draft', onClose: vi.fn(), onSave })
    .props.children.props.children[1];
  expect(form().props.children[1].props['aria-invalid']).toBeUndefined();
  form().props.onSubmit({ preventDefault: vi.fn() });
  const failed = form();
  const input = failed.props.children[1];
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(input.props['aria-invalid']).toBeUndefined();
  expect(input.props['aria-describedby']).toBe(alert.props.id);
  expect(input.props.value).toBe('Draft');
  input.props.onChange({ target: { value: 'Corrected name' } });
  expect(form().props.children[1].props['aria-invalid']).toBeUndefined();
  expect(form().props.children[1].props['aria-describedby']).toBeUndefined();
  expect(onSave).toHaveBeenCalledOnce();
});

it('selects the initial name once and preserves the correction selection when a failed save restores focus', () => {
  const onSave = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'My draft name', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  const select = vi.fn();
  const target = { select, focus: vi.fn(() => input.props.onFocus({ currentTarget: target })) };
  input.ref.current = target;
  input.props.onFocus({ currentTarget: target });
  expect(select).toHaveBeenCalledOnce();
  select.mockClear();
  // Model a caret/selection placed while editing, then Save returning focus
  // after storage fails. Refocusing must not select and overwrite the draft.
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('My draft name');
  expect(target.focus).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  expect(input.props.value).toBe('My draft name');
});

it('preserves a rename draft for secondary backdrop clicks and dismisses on a primary backdrop click', () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Unsaved draft', onClose, onSave });
  const backdrop = {};
  for (const button of [1, 2]) {
    view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, button });
    expect(onClose).not.toHaveBeenCalled();
  }
  view.props.onMouseDown({ target: {}, currentTarget: backdrop, button: 0 });
  expect(onClose).not.toHaveBeenCalled();
  expect(view.props.children.props.children[1].props.children[1].props.value).toBe('Unsaved draft');
  view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, button: 0 });
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

it('preserves an unsaved rename when a backdrop press was consumed by another handler', () => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Unsaved draft', onClose, onSave });
  const backdrop = {};
  view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, button: 0, defaultPrevented: true });
  expect(onClose).not.toHaveBeenCalled();
  expect(view.props.children.props.children[1].props.children[1].props.value).toBe('Unsaved draft');
  expect(onSave).not.toHaveBeenCalled();
  view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, button: 0, defaultPrevented: false });
  expect(onClose).toHaveBeenCalledOnce();
});

it('explains a blank keyboard rename submission and focuses the retained draft for correction', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const form = () => RenameDialog({ title: 'Rename chat', initialValue: '   ', onClose, onSave })
    .props.children.props.children[1];
  const initial = form();
  // A disabled default submit button would suppress the browser's Enter submission.
  expect(initial.props.children[3].props.children[1].props.disabled).toBeFalsy();
  const focus = vi.fn();
  initial.props.children[1].ref.current = { focus };
  initial.props.onSubmit({ preventDefault: vi.fn() });
  const invalid = form();
  const input = invalid.props.children[1];
  const alert = invalid.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Enter a name.');
  expect(input.props['aria-invalid']).toBe(true);
  expect(input.props['aria-describedby']).toBe(alert.props.id);
  expect(input.props.value).toBe('   ');
  expect(focus).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  input.props.onChange({ target: { value: 'Corrected name' } });
  expect(form().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
});

it('preserves a rename draft for modified Enter from either the input or Save button', () => {
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Unsaved draft', onClose: vi.fn(), onSave });
  const form = view.props.children.props.children[1];
  const input = form.props.children[1];
  for (const handler of [input.props.onKeyDown, form.props.onKeyDown]) {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const event = { key: 'Enter', [modifier]: true, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
      handler(event);
      if (!event.preventDefault.mock.calls.length) form.props.onSubmit({ preventDefault: vi.fn() });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
    }
  }
  expect(input.props.value).toBe('Unsaved draft');
  const enter = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  form.props.onKeyDown(enter);
  expect(enter.preventDefault).not.toHaveBeenCalled();
  form.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Unsaved draft');
});

it('preserves an overlength existing name with correction guidance instead of saving it', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const name = 'a'.repeat(121);
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const form = (initialValue = name) => RenameDialog({ title: 'Rename chat', initialValue, onClose, onSave })
    .props.children.props.children[1];
  const initial = form();
  const focus = vi.fn();
  initial.props.children[1].ref.current = { focus };
  initial.props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  const invalid = form();
  const input = invalid.props.children[1];
  const alert = invalid.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(input.props.value).toBe(name);
  expect(input.props['aria-invalid']).toBe(true);
  expect(alert?.props.children).toBe('Use a name of 120 characters or fewer.');
  expect(input.props['aria-describedby']).toBe(alert.props.id);
  input.props.onChange({ target: { value: 'a'.repeat(120) } });
  // Supply the corrected state on the next render in this hook fixture.
  form('a'.repeat(120)).props.onSubmit({ preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('a'.repeat(120));
  expect(state.error).toBe('');
});

it('preserves a rename draft when submission was cancelled before reaching the form', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Unsaved draft', onClose, onSave });
  const form = view.props.children.props.children[1];
  // A submit capture handler may cancel validation or an enclosing workflow.
  form.props.onSubmit({ defaultPrevented: true, preventDefault: vi.fn() });
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(state.setError).not.toHaveBeenCalled();
  expect(form.props.children[1].props.value).toBe('Unsaved draft');
  form.props.onSubmit({ defaultPrevented: false, preventDefault: vi.fn() });
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Unsaved draft');
});

it('retains the rename draft and failure feedback when a dismissal click was cancelled', () => {
  state.error = 'Could not rename. Your name is still here. Try again.';
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = RenameDialog({ title: 'Rename chat', initialValue: 'Unsaved draft', onClose, onSave });
  const dialog = view.props.children;
  const form = dialog.props.children[1];
  const close = dialog.props.children[0].props.children[1];
  const cancel = form.props.children[3].props.children[0];
  for (const button of [close, cancel]) {
    button.props.onClick({ defaultPrevented: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(state.setError).not.toHaveBeenCalled();
    expect(form.props.children[1].props.value).toBe('Unsaved draft');
    expect(form.props.children[2].props.children).toBe(state.error);
  }
  expect(onSave).not.toHaveBeenCalled();
  for (const button of [close, cancel]) button.props.onClick({ defaultPrevented: false });
  expect(onClose).toHaveBeenCalledTimes(2);
});
