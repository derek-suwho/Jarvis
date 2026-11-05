import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slot: 0, editing: true, draft: 'Revised instruction', setEditing: vi.fn(), error: '', setError: vi.fn(), pending: false, setPending: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'test-edit-error',
  useState: () => {
    const slot = state.slot++;
    return slot === 0 ? [state.editing, state.setEditing] : slot === 1 ? [state.draft, vi.fn()] : slot === 3 ? [state.error, state.setError] : slot === 4 ? [state.pending, state.setPending] : [false, vi.fn()];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
}));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), ''] }));
import { MessageItem } from '../src/components/MessageItem';

afterEach(() => { state.slot = 0; state.error = ''; state.pending = false; vi.clearAllMocks(); });

it('keeps an edit open when Enter is pressed during a running reply and permits sending after it finishes', () => {
  const onEdit = vi.fn();
  const render = (busy: boolean) => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy, onEdit });
  };
  const editor = (view: any) => view.props.children.props.children[0];
  editor(render(true)).props.onKeyDown({ key: 'Enter', shiftKey: false,
    nativeEvent: { isComposing: false }, preventDefault: vi.fn() });
  expect(onEdit).not.toHaveBeenCalled();
  expect(state.setEditing).not.toHaveBeenCalled();
  editor(render(false)).props.onKeyDown({ key: 'Enter', shiftKey: false,
    nativeEvent: { isComposing: false }, preventDefault: vi.fn() });
  expect(onEdit).toHaveBeenCalledExactlyOnceWith('user-1', 'Revised instruction');
  expect(state.setEditing).toHaveBeenCalledExactlyOnceWith(false);
});

it.each([
  ['Escape', true, 27],
  ['Escape', false, 229],
  ['Enter', true, 13],
  ['Enter', false, 229],
])('preserves the edit while the input method handles %s (composing=%s, code=%s)', (key, isComposing, keyCode) => {
  const onEdit = vi.fn();
  const view = MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
    streaming: false, isLast: false, busy: false, onEdit });
  const preventDefault = vi.fn();
  view.props.children.props.children[0].props.onKeyDown({ key, shiftKey: false,
    nativeEvent: { isComposing, keyCode }, preventDefault });
  expect(state.setEditing).not.toHaveBeenCalled();
  expect(onEdit).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
});

it('consumes Escape when cancelling an edit after composition finishes', () => {
  const onEdit = vi.fn();
  const view = MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
    streaming: false, isLast: false, busy: false, onEdit });
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  view.props.children.props.children[0].props.onKeyDown({ key: 'Escape',
    nativeEvent: { isComposing: false, keyCode: 27 }, preventDefault, stopPropagation });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(state.setEditing).toHaveBeenCalledExactlyOnceWith(false);
  expect(onEdit).not.toHaveBeenCalled();
});


it.each(['throw', 'reject'])('preserves a failed message edit and permits retry after %s', async (failure) => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const onEdit = vi.fn().mockImplementationOnce(() => {
    if (failure === 'throw') throw new Error('private backend detail');
    return Promise.reject(new Error('private backend detail'));
  });
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit });
  };
  const box = () => render().props.children;
  const send = () => box().props.children.find((child: any) => child?.props?.className === 'edit-actions').props.children[1].props.onClick();
  await send();
  expect(state.setEditing).not.toHaveBeenCalled();
  expect(box().props.children[0].props.value).toBe('Revised instruction');
  expect(box().props.children.find((child: any) => child?.props?.role === 'alert')?.props.children)
    .toBe('Could not send your edit. Your draft is still here. Try again.');
  await send();
  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(state.setEditing).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.error).toBe('');
});

it.each(['sync', 'async'])('retains the edit after an explicit unsuccessful %s result and permits retry', async (mode) => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const onEdit = vi.fn().mockImplementationOnce(() => mode === 'sync' ? false : Promise.resolve(false))
    .mockResolvedValueOnce(true);
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit });
  };
  const send = () => render().props.children.props.children.find((child: any) => child?.props?.className === 'edit-actions').props.children[1].props.onClick();
  await send();
  expect(state.setEditing).not.toHaveBeenCalled();
  expect(render().props.children.props.children[0].props.value).toBe('Revised instruction');
  expect(state.error).toBe('Could not send your edit. Your draft is still here. Try again.');
  await send();
  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(state.setEditing).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.error).toBe('');
});


it('announces a pending edit and protects the submitted draft until a failed save permits correction', async () => {
  state.setPending.mockImplementation((value: boolean) => { state.pending = value; });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  let finish!: (value: boolean) => void;
  const onEdit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit }).props.children;
  };
  const send = (box: any) => box.props.children.find((child: any) => child?.props?.className === 'edit-actions').props.children[1];
  const attempt = send(render()).props.onClick();
  const pending = render();
  expect(pending.props['aria-busy']).toBe(true);
  expect(pending.props.children[0].props.readOnly).toBe(true);
  expect(pending.props.children[0].props.value).toBe('Revised instruction');
  expect(send(pending).props.disabled).toBe(true);
  expect(pending.props.children.find((child: any) => child?.props?.role === 'status')?.props.children).toBe('Sending edit…');
  finish(false);
  await attempt;
  const recovered = render();
  expect(recovered.props['aria-busy']).toBe(false);
  expect(recovered.props.children[0].props.readOnly).toBe(false);
  expect(send(recovered).props.disabled).toBe(false);
  expect(recovered.props.children.some((child: any) => child?.props?.role === 'status')).toBe(false);
  expect(state.setEditing).not.toHaveBeenCalled();
});

it('associates submission failure with a valid draft without marking its content invalid', () => {
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit: vi.fn() }).props.children;
  };
  state.error = 'Could not send your edit. Your draft is still here. Try again.';
  const failed = render();
  const input = failed.props.children[0];
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.id).toBeTruthy();
  expect(input.props['aria-describedby'].split(' ')).toContain(alert.props.id);
  expect(input.props['aria-invalid']).toBeUndefined();
  state.error = '';
  const recovered = render().props.children[0];
  expect(recovered.props['aria-describedby']).toBe('test-edit-error-warning');
  expect(recovered.props['aria-invalid']).toBeUndefined();
});


it('describes the replacement consequence before editing and retains it alongside failure feedback', () => {
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit: vi.fn() }).props.children;
  };
  const box = render();
  const warning = box.props.children.find((child: any) => child?.props?.className === 'edit-warning');
  expect(warning.props.children).toBe('Sending an edit replaces the replies after this message.');
  expect(warning.props.id).toBeTruthy();
  expect(box.props.children[0].props['aria-describedby'].split(' ')).toContain(warning.props.id);
  state.error = 'Could not send your edit. Your draft is still here. Try again.';
  const failed = render();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(failed.props.children[0].props['aria-describedby'].split(' ')).toEqual([warning.props.id, alert.props.id]);
});

it.each(['Enter', 'Escape'])('preserves an unsent message edit on held %s', (key) => {
  const onEdit = vi.fn();
  const view = MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
    streaming: false, isLast: false, busy: false, onEdit });
  view.props.children.props.children[0].props.onKeyDown({ key, repeat: true, shiftKey: false,
    nativeEvent: { isComposing: false, keyCode: key === 'Enter' ? 13 : 27 }, preventDefault: vi.fn() });
  expect(onEdit).not.toHaveBeenCalled();
  expect(state.setEditing).not.toHaveBeenCalled();
});

it('clears stale failed-edit feedback when the user corrects the retained draft without resending', () => {
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const onEdit = vi.fn(() => false);
  const render = () => {
    state.slot = 0;
    return MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
      streaming: false, isLast: false, busy: false, onEdit }).props.children;
  };
  const initial = render();
  initial.props.children.find((child: any) => child?.props?.className === 'edit-actions').props.children[1].props.onClick();
  const failed = render();
  expect(failed.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(true);
  expect(failed.props.children[0].props['aria-invalid']).toBeUndefined();
  failed.props.children[0].props.onChange({ target: { value: 'Corrected instruction' } });
  const corrected = render();
  expect(corrected.props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(corrected.props.children[0].props['aria-invalid']).toBeUndefined();
  expect(corrected.props.children[0].props['aria-describedby']).toBe('test-edit-error-warning');
  expect(onEdit).toHaveBeenCalledOnce();
  expect(state.setEditing).not.toHaveBeenCalled();
});

it.each(['Enter', 'Escape'])('preserves the message draft when another handler has consumed %s', (key) => {
  const onEdit = vi.fn();
  const view = MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
    streaming: false, isLast: false, busy: false, onEdit });
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const editor = view.props.children.props.children[0];
  editor.props.onKeyDown({ key, defaultPrevented: true,
    nativeEvent: { isComposing: false, keyCode: key === 'Enter' ? 13 : 27 }, preventDefault, stopPropagation });
  expect(onEdit).not.toHaveBeenCalled();
  expect(state.setEditing).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(stopPropagation).not.toHaveBeenCalled();
  expect(editor.props.value).toBe('Revised instruction');
});
