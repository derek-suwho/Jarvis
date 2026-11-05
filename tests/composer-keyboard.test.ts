import { expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, setters: [] as ReturnType<typeof vi.fn>[], attachments: [] as any[], errors: [] as string[], pendingFiles: 0, submitting: false, sendError: null as string | null }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => { const setter = vi.fn(); hooks.setters.push(setter); return [hooks.setters.length === 5 ? hooks.submitting : value === null ? hooks.sendError : value, setter]; },
  useRef: (current: unknown) => { const ref = { current }; hooks.refs.push(ref); return ref; },
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useId: () => 'composer',
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/lib/drafts', () => ({
  getDraft: () => ({ text: 'Draft message', attachments: hooks.attachments, pendingFiles: hooks.pendingFiles, errors: hooks.errors }),
  captureDraft: () => ({ draft: { text: 'Draft message', attachments: [], pendingFiles: 0 } }),
  consumeSubmittedDraft: vi.fn(),
  subscribeToDraft: vi.fn(), setDraftText: vi.fn(), attachDraftFiles: vi.fn(),
  clearDraftErrors: vi.fn(), removeDraftAttachment: vi.fn(),
}));
import { Composer } from '../src/components/Composer';
import { DEFAULT_SETTINGS } from '../src/lib/models';
import { clearDraftErrors, consumeSubmittedDraft, removeDraftAttachment } from '../src/lib/drafts';

it('preserves the draft for IME confirmation key code 229 and sends on ordinary Enter', async () => {
  const onSend = vi.fn();
  const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend, disabled: false });
  const textarea = view.props.children[0].props.children.find((child: any) => child?.type === 'textarea');
  const event = (keyCode: number) => ({ key: 'Enter', shiftKey: false,
    nativeEvent: { isComposing: false, keyCode }, preventDefault: vi.fn() });
  const confirmation = event(229);
  textarea.props.onKeyDown(confirmation);
  await Promise.resolve();
  expect(onSend).not.toHaveBeenCalled();
  expect(consumeSubmittedDraft).not.toHaveBeenCalled();
  expect(confirmation.preventDefault).not.toHaveBeenCalled();
  const enter = event(13);
  textarea.props.onKeyDown(enter);
  await Promise.resolve();
  expect(onSend).toHaveBeenCalledExactlyOnceWith('Draft message', []);
  expect(consumeSubmittedDraft).toHaveBeenCalledOnce();
  expect(enter.preventDefault).toHaveBeenCalledOnce();
});

it('preserves the draft while Enter is held and sends on a fresh key press', async () => {
  vi.mocked(consumeSubmittedDraft).mockClear();
  const onSend = vi.fn();
  const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend, disabled: false });
  const textarea = view.props.children[0].props.children.find((child: any) => child?.type === 'textarea');
  const held = { key: 'Enter', shiftKey: false, repeat: true,
    nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  textarea.props.onKeyDown(held);
  await Promise.resolve();
  expect(onSend).not.toHaveBeenCalled();
  expect(consumeSubmittedDraft).not.toHaveBeenCalled();
  expect(held.preventDefault).toHaveBeenCalledOnce();
  const fresh = { ...held, repeat: false, preventDefault: vi.fn() };
  textarea.props.onKeyDown(fresh);
  await Promise.resolve();
  expect(onSend).toHaveBeenCalledExactlyOnceWith('Draft message', []);
  expect(consumeSubmittedDraft).toHaveBeenCalledOnce();
  expect(fresh.preventDefault).toHaveBeenCalledOnce();
});

it.each([
  ['rejected result', true], ['thrown error', true], ['success', true],
  ['rejected result', false], ['thrown error', false], ['success', false],
] as const)('scopes delayed send %s feedback to its chat (switched: %s)', async (outcome, switched) => {
  hooks.refs.length = 0;
  hooks.setters.length = 0;
  vi.mocked(consumeSubmittedDraft).mockClear();
  let resolve!: (value: any) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  const onSend = vi.fn(() => pending);
  const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend, disabled: false, draftKey: 'original-chat' });
  const textarea = view.props.children[0].props.children.find((child: any) => child?.type === 'textarea');
  textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() });
  expect(onSend).toHaveBeenCalledOnce();
  // Simulate the active-key ref being updated by navigation while the send is pending.
  const activeKey = hooks.refs.find((ref) => ref.current === 'original-chat')!;
  if (switched) activeKey.current = 'new-chat';
  hooks.setters.forEach((setter) => setter.mockClear());
  if (outcome === 'thrown error') reject(new Error('Provider unavailable'));
  else resolve(outcome === 'success' ? undefined : { ok: false, message: 'Provider unavailable' });
  await pending.catch(() => {});
  await Promise.resolve();
  if (switched) {
    expect(hooks.setters[3]).not.toHaveBeenCalled(); // sendError
    expect(hooks.setters[2]).not.toHaveBeenCalled(); // notice
  } else if (outcome === 'success') {
    expect(hooks.setters[2]).toHaveBeenCalledWith('');
  } else {
    expect(hooks.setters[3]).toHaveBeenCalledWith('Provider unavailable');
  }
  if (outcome === 'success') expect(consumeSubmittedDraft).toHaveBeenCalledOnce();
  else expect(consumeSubmittedDraft).not.toHaveBeenCalled();
});


it('returns focus to the message after removing an attachment', () => {
  hooks.refs.length = 0;
  hooks.attachments = [{ id: 'file-1', name: 'notes.txt', size: 20, type: 'text/plain' }];
  try {
    const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: vi.fn(), disabled: false, draftKey: 'chat-with-file' });
    const children = view.props.children[0].props.children;
    const textarea = children.find((child: any) => child?.type === 'textarea');
    const focus = vi.fn();
    textarea.ref.current = { focus };
    const files = children.find((child: any) => child?.props?.className === 'composer-files');
    const remove = files.props.children[0].props.children.find((child: any) => child?.type === 'button');
    remove.props.onClick();
    expect(removeDraftAttachment).toHaveBeenLastCalledWith('chat-with-file', 'file-1', true);
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    hooks.attachments = [];
  }
});


it.each(['file', 'message'] as const)('returns focus to Message when dismissing a %s error', (kind) => {
  hooks.refs.length = 0;
  hooks.setters.length = 0;
  hooks.errors = kind === 'file' ? ['Could not read file'] : [];
  hooks.sendError = kind === 'message' ? 'Could not send' : null;
  vi.mocked(clearDraftErrors).mockClear();
  try {
    const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: vi.fn(), disabled: false, draftKey: 'error-chat' });
    const children = view.props.children[0].props.children;
    const textarea = children.find((child: any) => child?.type === 'textarea');
    const focus = vi.fn();
    textarea.ref.current = { focus };
    const alert = children.find((child: any) => child?.props?.role === 'alert');
    const dismiss = alert.props.children.find((child: any) => child?.type === 'button');
    dismiss.props.onClick();
    if (kind === 'file') expect(clearDraftErrors).toHaveBeenCalledExactlyOnceWith('error-chat', true);
    else expect(hooks.setters[3]).toHaveBeenCalledExactlyOnceWith(null);
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    hooks.errors = [];
    hooks.sendError = null;
  }
});

it('describes Message with active errors and removes their references after recovery', () => {
  const render = () => Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: vi.fn(), disabled: false });
  const children = (view: any) => view.props.children[0].props.children;
  const textarea = (view: any) => children(view).find((child: any) => child?.type === 'textarea');
  hooks.errors = ['Could not read file'];
  hooks.sendError = 'Could not send';
  try {
    const failed = render();
    const alerts = children(failed).filter((child: any) => child?.props?.role === 'alert');
    expect(alerts.map((alert: any) => alert.props.id)).toEqual(['composer-file-errors', 'composer-send-error']);
    expect(textarea(failed).props['aria-describedby']).toBe('composer-hint composer-file-errors composer-send-error');
    hooks.errors = [];
    const fileRecovered = render();
    expect(textarea(fileRecovered).props['aria-describedby']).toBe('composer-hint composer-send-error');
    hooks.sendError = null;
    const recovered = render();
    expect(textarea(recovered).props['aria-describedby']).toBe('composer-hint');
    expect(children(recovered).some((child: any) => child?.props?.role === 'alert')).toBe(false);
  } finally {
    hooks.errors = [];
    hooks.sendError = null;
  }
});

it.each([false, true])('preserves user focus during delayed send completion (moved: %s)', async (moved) => {
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => { complete = resolve; });
  const sendButton = {};
  const otherControl = {};
  const document = { activeElement: sendButton, body: {} };
  vi.stubGlobal('document', document);
  try {
    const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: () => pending, disabled: false });
    const children = view.props.children[0].props.children;
    const textarea = children.find((child: any) => child?.type === 'textarea');
    const focus = vi.fn();
    textarea.ref.current = { focus };
    textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() });
    if (moved) document.activeElement = otherControl;
    complete();
    await pending;
    await Promise.resolve();
    expect(focus).toHaveBeenCalledTimes(moved ? 0 : 1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('preserves the draft when another handler has consumed Enter and sends on a fresh Enter', async () => {
  vi.mocked(consumeSubmittedDraft).mockClear();
  const onSend = vi.fn();
  const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend, disabled: false });
  const textarea = view.props.children[0].props.children.find((child: any) => child?.type === 'textarea');
  const consumed = { key: 'Enter', defaultPrevented: true, shiftKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() };
  textarea.props.onKeyDown(consumed);
  await Promise.resolve();
  expect(onSend).not.toHaveBeenCalled();
  expect(consumeSubmittedDraft).not.toHaveBeenCalled();
  expect(consumed.preventDefault).not.toHaveBeenCalled();
  const fresh = { ...consumed, defaultPrevented: false, preventDefault: vi.fn() };
  textarea.props.onKeyDown(fresh);
  await Promise.resolve();
  expect(onSend).toHaveBeenCalledExactlyOnceWith('Draft message', []);
  expect(consumeSubmittedDraft).toHaveBeenCalledOnce();
  expect(fresh.preventDefault).toHaveBeenCalledOnce();
});

it.each(['Provider unavailable. Try again.', 'This message exceeds the provider context limit.'])('associates send failure feedback without asserting draft invalidity: %s', (message) => {
  const renderInput = () => Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: vi.fn(), disabled: false })
    .props.children[0].props.children.find((child: any) => child?.type === 'textarea');
  try {
    expect(renderInput().props['aria-invalid']).toBeUndefined();
    hooks.sendError = message;
    const failed = renderInput();
    expect(failed.props['aria-invalid']).toBeUndefined();
    expect(failed.props['aria-describedby']).toContain('composer-send-error');
    expect(failed.props.value).toBe('Draft message');
    hooks.sendError = null;
    hooks.errors = ['Could not read file'];
    expect(renderInput().props['aria-invalid']).toBeUndefined();
    expect(renderInput().props['aria-describedby']).toContain('composer-file-errors');
    hooks.errors = [];
    expect(renderInput().props['aria-invalid']).toBeUndefined();
  } finally {
    hooks.sendError = null;
    hooks.errors = [];
  }
});


it('exposes composer preparation and submission as busy while keeping progress announcements outside the busy region', () => {
  const render = () => {
    hooks.setters.length = 0;
    return Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: vi.fn(), disabled: false });
  };
  try {
    expect(render().props.children[0].props['aria-busy']).toBe(false);
    hooks.pendingFiles = 1;
    const reading = render();
    expect(reading.props.children[0].props['aria-busy']).toBe(true);
    const status = reading.props.children[1].props.children[0];
    expect(status.props.role).toBe('status');
    expect(status.props.children).toBe('Reading 1 file…');
    expect(reading.props['aria-busy']).toBeUndefined();
    hooks.pendingFiles = 0;
    hooks.submitting = true;
    const sending = render();
    expect(sending.props.children[0].props['aria-busy']).toBe(true);
    expect(sending.props.children[1].props.children[0].props.children).toBe('Sending…');
    hooks.submitting = false;
    expect(render().props.children[0].props['aria-busy']).toBe(false);
  } finally {
    hooks.pendingFiles = 0;
    hooks.submitting = false;
  }
});

it('clears the previous send failure while retrying and restores feedback if the retry fails', async () => {
  hooks.refs.length = 0;
  hooks.setters.length = 0;
  hooks.sendError = 'Previous send failed';
  vi.mocked(consumeSubmittedDraft).mockClear();
  let complete!: (result: any) => void;
  const pending = new Promise<any>((resolve) => { complete = resolve; });
  try {
    const view = Composer({ model: DEFAULT_SETTINGS, onModelChange: vi.fn(), onSend: () => pending, disabled: false });
    const textarea = view.props.children[0].props.children.find((child: any) => child?.type === 'textarea');
    textarea.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn() });
    expect(hooks.setters[3]).toHaveBeenCalledExactlyOnceWith(null);
    expect(consumeSubmittedDraft).not.toHaveBeenCalled();
    complete({ ok: false, message: 'Retry failed. Your draft is still here.' });
    await pending;
    await Promise.resolve();
    expect(hooks.setters[3]).toHaveBeenLastCalledWith('Retry failed. Your draft is still here.');
    expect(consumeSubmittedDraft).not.toHaveBeenCalled();
    expect(textarea.props.value).toBe('Draft message');
  } finally {
    complete({ ok: false, message: 'Retry failed. Your draft is still here.' });
    await pending;
    hooks.sendError = null;
  }
});
