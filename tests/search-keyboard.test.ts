import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ set: vi.fn(), index: 0, cursor: 0, refIndex: 0, refs: null as null | Array<{ current: unknown }>, query: '', error: '', setError: vi.fn(), effects: [] as Array<{ run: () => void; deps: unknown[] }> }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => state.index++ === 2 ? [state.error, state.setError] : [typeof value === 'string' ? state.query : state.cursor, state.set],
  useRef: () => {
    if (!state.refs) return { current: null };
    const index = state.refIndex++;
    return state.refs[index] ?? (state.refs[index] = { current: null });
  },
  useId: () => 'search',
  useEffect: (run: () => void, deps: unknown[]) => state.effects.push({ run, deps }),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock('../src/components/useDialog', () => ({ useDialog: () => {} }));
import { SearchDialog } from '../src/components/SearchDialog';

afterEach(() => { state.index = 0; state.cursor = 0; state.refs = null; state.refIndex = 0; state.query = ''; state.error = ''; state.effects.length = 0; vi.clearAllMocks(); state.set.mockReset(); vi.unstubAllGlobals(); });

it('retains a typed search for secondary or consumed backdrop presses and dismisses on a fresh primary press', () => {
  state.query = 'Important conversation';
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const view = SearchDialog({ chats: [], onSelect, onNewChat, onClose });
  const backdrop = {};
  for (const patch of [{ button: 1 }, { button: 2 }, { button: 0, defaultPrevented: true }]) {
    view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, ...patch });
    expect(onClose).not.toHaveBeenCalled();
  }
  view.props.onMouseDown({ target: {}, currentTarget: backdrop, button: 0 });
  expect(onClose).not.toHaveBeenCalled();
  expect(findInput(view)!.props.value).toBe('Important conversation');
  view.props.onMouseDown({ target: backdrop, currentTarget: backdrop, button: 0, defaultPrevented: false });
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
});

function findInput(node: ReactElement<any>): ReactElement<any> | undefined {
  if (node.type === 'input') return node;
  for (const child of [node.props.children].flat()) {
    if (child && typeof child === 'object') {
      const found = findInput(child);
      if (found) return found;
    }
  }
}

it('leaves IME navigation and confirmation to the input while preserving ordinary search keys', () => {
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect: vi.fn(), onNewChat, onClose }))!;
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
    const event = { key, nativeEvent: { isComposing: true }, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
    expect(onNewChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  }
  const arrow = { key: 'ArrowDown', nativeEvent: { isComposing: false }, preventDefault: vi.fn() };
  input.props.onKeyDown(arrow);
  expect(state.set).toHaveBeenCalledOnce();
  expect(arrow.preventDefault).toHaveBeenCalledOnce();
  input.props.onKeyDown({ ...arrow, key: 'Enter' });
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});


it('keeps legacy IME confirmation from opening a conversation or starting a new chat', () => {
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect, onNewChat, onClose }))!;
  const confirmation = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 229 }, preventDefault: vi.fn() };
  input.props.onKeyDown(confirmation);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(confirmation.preventDefault).not.toHaveBeenCalled();
  input.props.onKeyDown({ ...confirmation, nativeEvent: { isComposing: false, keyCode: 13 } });
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('does not navigate or open search results for already-handled keys', () => {
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect, onNewChat, onClose }))!;
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
    const event = { key, defaultPrevented: true, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(state.set).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onNewChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
});

it('pages through search results while respecting event ownership', () => {
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const chats = Array.from({ length: 25 }, (_, index) => ({
    id: `chat-${index}`, title: `Chat ${index}`, messages: [], updatedAt: index + 1,
  }));
  const input = findInput(SearchDialog({ chats: chats as any, onSelect, onNewChat, onClose }))!;
  for (const [key, fromFirst, fromLast] of [['PageDown', 11, 25], ['PageUp', 0, 12]] as const) {
    for (const properties of [
      { defaultPrevented: true, nativeEvent: {} },
      { nativeEvent: { isComposing: true } },
      { nativeEvent: { keyCode: 229 } },
    ]) {
      const event = { key, preventDefault: vi.fn(), ...properties };
      input.props.onKeyDown(event);
      expect(state.set).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const event = { key, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(state.set).toHaveBeenCalledOnce();
    const move = state.set.mock.calls[0][0];
    expect(move(1)).toBe(fromFirst);
    expect(move(22)).toBe(fromLast);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    state.set.mockClear();
  }
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('navigates from the visible selection after the result list shrinks', () => {
  const chats = Array.from({ length: 2 }, (_, index) => ({
    id: `chat-${index}`, title: `Chat ${index}`, messages: [], updatedAt: index + 1,
  }));
  const input = findInput(SearchDialog({
    chats: chats as any, onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn(),
  }))!;
  // A previously selected result has disappeared; the displayed selection is
  // clamped to the final remaining option (Start a new chat, index 2).
  for (const [key, expected] of [
    ['ArrowDown', 0], ['ArrowUp', 1], ['PageDown', 2], ['PageUp', 0],
  ] as const) {
    const event = { key, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    const move = state.set.mock.calls.at(-1)![0];
    expect(move(19), key).toBe(expected);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
});

it('preserves modified input shortcuts without navigating or opening search results', () => {
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect, onNewChat, onClose }))!;
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Enter']) {
      const event = { key, [modifier]: true, nativeEvent: {}, preventDefault: vi.fn() };
      input.props.onKeyDown(event);
      expect(event.preventDefault, `${modifier}+${key}`).not.toHaveBeenCalled();
      expect(state.set).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
      expect(onNewChat).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }
  }
  input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});


it('keeps search available after opening fails and clears its safe error on retry', () => {
  state.query = 'Saved';
  const onSelect = vi.fn().mockImplementationOnce(() => { throw new Error('private failure detail'); });
  const onClose = vi.fn();
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => {
    state.index = 0;
    state.effects.length = 0;
    state.refIndex = 0;
    return SearchDialog({
      chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
      onSelect, onNewChat: vi.fn(), onClose,
    });
  };
  const open = () => findInput(render())!.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(open).not.toThrow();
  expect(onClose).not.toHaveBeenCalled();
  const dialog = render().props.children;
  const alert = dialog.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not open this conversation. Try again.');
  expect(alert?.props.id).toBe('search-error');
  expect(findInput(render())!.props['aria-describedby']).toBe(alert.props.id);
  expect(findInput(render())!.props.value).toBe('Saved');
  open();
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenLastCalledWith('chat');
  expect(onClose).toHaveBeenCalledOnce();
  expect(state.error).toBe('');
  expect(findInput(render())!.props['aria-describedby']).toBeUndefined();
});

it('preserves combobox focus when pressing results so failed opens retain keyboard navigation', () => {
  const onSelect = vi.fn(() => { throw new Error('storage unavailable'); });
  const onNewChat = vi.fn(() => { throw new Error('storage unavailable'); });
  const onClose = vi.fn();
  const view = SearchDialog({
    chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
    onSelect, onNewChat, onClose,
  });
  const list = view.props.children.props.children.find((child: any) => child?.props?.role === 'listbox');
  const options = list.props.children.flat().filter((child: any) => child?.props?.role === 'option');
  expect(options).toHaveLength(2);
  for (const option of options) {
    const press = { preventDefault: vi.fn() };
    option.props.onMouseDown?.(press);
    // Cancelling mousedown prevents the browser moving focus off the combobox.
    expect(press.preventDefault).toHaveBeenCalledOnce();
    expect(() => option.props.onClick({ defaultPrevented: false })).not.toThrow();
  }
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('chat');
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  state.set.mockClear();
  findInput(view)!.props.onKeyDown({ key: 'ArrowDown', nativeEvent: {}, preventDefault: vi.fn() });
  expect(state.set).toHaveBeenCalledOnce();
});

it('jumps to the first and last search options with Home and End while preserving input shortcuts', () => {
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const chats = Array.from({ length: 45 }, (_, index) => ({
    id: `chat-${index}`, title: `Chat ${index}`, messages: [], updatedAt: index + 1,
  }));
  const input = findInput(SearchDialog({ chats: chats as any, onSelect, onNewChat, onClose: vi.fn() }))!;
  for (const [key, boundary] of [['Home', 0], ['End', 40]] as const) {
    for (const properties of [
      { metaKey: true }, { ctrlKey: true }, { altKey: true },
      { defaultPrevented: true }, { nativeEvent: { isComposing: true } },
      { nativeEvent: { keyCode: 229 } },
    ]) {
      const event = { key, nativeEvent: {}, preventDefault: vi.fn(), ...properties };
      input.props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(state.set).not.toHaveBeenCalled();
    }
    const event = { key, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.set).toHaveBeenCalledExactlyOnceWith(boundary);
    state.set.mockClear();
  }
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
});

it('requires a fresh Enter press to retry a failed open while allowing held-arrow navigation', () => {
  const onNewChat = vi.fn().mockImplementationOnce(() => { throw new Error('unavailable'); });
  const onClose = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect: vi.fn(), onNewChat, onClose }))!;
  const press = (key: string, repeat: boolean) => {
    const event = { key, repeat, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    return event;
  };
  press('Enter', false);
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  press('Enter', true);
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  state.set.mockClear();
  expect(press('ArrowDown', true).preventDefault).toHaveBeenCalledOnce();
  expect(state.set).toHaveBeenCalledOnce();
  press('Enter', false);
  expect(onNewChat).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

it('preserves Shift text-selection shortcuts while editing a search query', () => {
  state.query = 'Saved conversation';
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect, onNewChat, onClose: vi.fn() }))!;
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    const event = { key, shiftKey: true, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(event.preventDefault, `Shift+${key} must retain native selection`).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  }
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  const navigation = { key: 'ArrowDown', nativeEvent: {}, preventDefault: vi.fn() };
  input.props.onKeyDown(navigation);
  expect(navigation.preventDefault).toHaveBeenCalledOnce();
  expect(state.set).toHaveBeenCalledOnce();
});

it('clears a failed-open error when the user edits the search query', () => {
  state.query = 'Saved';
  const onSelect = vi.fn(() => { throw new Error('private storage detail'); });
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => {
    state.index = 0;
    state.effects.length = 0;
    state.refIndex = 0;
    return SearchDialog({
      chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
      onSelect, onNewChat: vi.fn(), onClose: vi.fn(),
    });
  };
  findInput(render())!.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(state.error).toBe('Could not open this conversation. Try again.');
  findInput(render())!.props.onChange({ target: { value: 'Different query' } });
  expect(state.set).toHaveBeenLastCalledWith('Different query');
  expect(state.error).toBe('');
  expect(findInput(render())!.props['aria-describedby']).toBeUndefined();
  expect(onSelect).toHaveBeenCalledOnce();
});


it('scrolls the active search result into view when a new query replaces results at the same index', () => {
  const scrollIntoView = vi.fn();
  const getElementById = vi.fn(() => ({ scrollIntoView }));
  vi.stubGlobal('document', { getElementById });
  const props = {
    chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
    onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn(),
  };
  const renderEffects = () => {
    state.index = 0;
    state.effects.length = 0;
    SearchDialog(props);
    return [...state.effects];
  };
  const initial = renderEffects();
  initial.forEach((effect) => effect.run());
  scrollIntoView.mockClear();
  state.query = 'No matching chat';
  const updated = renderEffects();
  updated.forEach((effect, index) => {
    if (effect.deps.some((value, dep) => !Object.is(value, initial[index].deps[dep]))) effect.run();
  });
  expect(getElementById).toHaveBeenLastCalledWith('search-0');
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
});

it('clears a failed-open error when moving to a different search selection', () => {
  state.error = 'Could not open this conversation. Try again.';
  const props = {
    chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
    onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn(),
  };
  const effects = () => {
    state.index = 0;
    state.effects.length = 0;
    SearchDialog(props);
    return [...state.effects];
  };
  vi.stubGlobal('document', { getElementById: () => null });
  const initial = effects();
  initial.forEach((effect) => effect.run());
  state.setError.mockClear();
  // The selected chat disappears, clamping selection to Start a new chat.
  props.chats = [];
  const updated = effects();
  updated.forEach((effect, index) => {
    if (effect.deps.some((value, dep) => !Object.is(value, initial[index].deps[dep]))) effect.run();
  });
  expect(state.setError).toHaveBeenCalledWith('');
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onNewChat).not.toHaveBeenCalled();
});

it('preserves native Home and End caret movement in a nonempty search query', () => {
  state.query = 'Saved conversation';
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const input = findInput(SearchDialog({ chats: [], onSelect, onNewChat, onClose: vi.fn() }))!;
  for (const key of ['Home', 'End']) {
    const event = { key, nativeEvent: {}, preventDefault: vi.fn() };
    input.props.onKeyDown(event);
    expect(event.preventDefault, `${key} must retain native caret movement`).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  }
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  const arrow = { key: 'ArrowDown', nativeEvent: {}, preventDefault: vi.fn() };
  input.props.onKeyDown(arrow);
  expect(arrow.preventDefault).toHaveBeenCalledOnce();
  expect(state.set).toHaveBeenCalledOnce();
});

it('discloses the recent conversation limit and how to find omitted chats only when truncated', () => {
  const chats = Array.from({ length: 41 }, (_, index) => ({
    id: `chat-${index}`, title: `Chat ${index}`, messages: [], updatedAt: index + 1,
  }));
  const render = (items: typeof chats, query = '') => {
    state.index = 0;
    state.query = query;
    return SearchDialog({ chats: items as any, onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn() });
  };
  const footer = (view: any) => view.props.children.props.children.find((child: any) => child?.type === 'footer').props.children[0];
  const truncated = render(chats);
  expect(footer(truncated).props['aria-live']).toBe('polite');
  expect(footer(truncated).props.children).toBe('Showing 40 recent conversations · Search to find older chats');
  expect(footer(render(chats.slice(0, 40))).props.children).toBe('Search titles and messages');
  expect(footer(render(chats, 'Chat')).props.children).toBe('41 results · Showing 40 · Narrow your search to find other matches');
  expect(footer(render([], '')).props.children).toBe('Search titles and messages');
});


it('guides users to omitted matching conversations only when the search result limit is exceeded', () => {
  const chats = Array.from({ length: 41 }, (_, index) => ({
    id: `chat-${index}`, title: `Saved ${index}`, messages: [], updatedAt: index + 1,
  }));
  const footer = (query: string) => {
    state.index = 0;
    state.query = query;
    const view = SearchDialog({ chats: chats as any, onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn() });
    return view.props.children.props.children.find((child: any) => child?.type === 'footer').props.children[0].props.children;
  };
  expect(footer('Saved')).toBe('41 results · Showing 40 · Narrow your search to find other matches');
  expect(footer('Saved 0')).toBe('1 result');
  expect(footer('missing')).toBe('0 results');
});

it('shows onboarding for a whitespace-only search in an empty library and search guidance for a real query', () => {
  const emptyState = (query: string) => {
    state.index = 0;
    state.query = query;
    const view = SearchDialog({ chats: [], onSelect: vi.fn(), onNewChat: vi.fn(), onClose: vi.fn() });
    const list = view.props.children.props.children.find((child: any) => child?.props?.role === 'listbox');
    return list.props.children[1];
  };
  const blank = emptyState('   ');
  expect(blank.props.role).toBe('status');
  expect(blank.props.children[0].props.children).toBe('Your next conversation starts here');
  expect(blank.props.children[1].props.children).toBe('Conversations you save will appear here.');
  const queried = emptyState('missing');
  expect(queried.props.children[0].props.children).toBe('No matches for “missing”');
  expect(queried.props.children[1].props.children).toBe('Try a different word or search for a message.');
});

it('clears a search and its stale error through a labelled control and returns focus to the input', () => {
  state.query = 'missing conversation';
  state.error = 'Could not open this conversation. Try again.';
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const render = () => SearchDialog({ chats: [], onClose, onSelect, onNewChat });
  const view = render();
  const input = findInput(view)!;
  const focus = vi.fn();
  const wrap = view.props.children.props.children[0];
  const clear = wrap.props.children.find((child: any) => child?.props?.['aria-label'] === 'Clear search');
  expect(clear).toBeDefined();
  expect(clear.props.type).toBe('button');
  (input as any).ref.current = { focus };
  clear.props.onClick({ defaultPrevented: false });
  expect(state.set).toHaveBeenCalledWith('');
  expect(state.set).toHaveBeenCalledWith(0);
  expect(state.setError).toHaveBeenCalledWith('');
  expect(focus).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  state.query = '';
  state.index = 0;
  expect(render().props.children.props.children[0].props.children.some((child: any) => child?.props?.['aria-label'] === 'Clear search')).toBe(false);
});

it('returns focus to the search input after direct option activation fails so keyboard retry remains available', () => {
  const onSelect = vi.fn().mockImplementationOnce(() => { throw new Error('private storage detail'); });
  const onNewChat = vi.fn().mockImplementationOnce(() => { throw new Error('private storage detail'); });
  const onClose = vi.fn();
  const view = SearchDialog({
    chats: [{ id: 'chat', title: 'Saved chat', messages: [], updatedAt: 1 }] as any,
    onSelect, onNewChat, onClose,
  });
  const input = findInput(view)!;
  const focus = vi.fn();
  (input as any).ref.current = { focus };
  const list = view.props.children.props.children.find((child: any) => child?.props?.role === 'listbox');
  const options = list.props.children.flat().filter((child: any) => child?.props?.role === 'option');
  for (const [index, option] of options.entries()) {
    // Assistive technology can activate an option without a preceding mousedown.
    option.props.onClick({ defaultPrevented: false });
    expect(focus).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenLastCalledWith(index === options.length - 1
      ? 'Could not start a new chat. Try again.'
      : 'Could not open this conversation. Try again.');
    focus.mockClear();
    option.props.onClick({ defaultPrevented: false });
    expect(onClose).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    onClose.mockClear();
  }
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(onNewChat).toHaveBeenCalledTimes(2);
});


it('retries the directly activated conversation after failure instead of the previously selected result', () => {
  const onSelect = vi.fn().mockImplementationOnce(() => { throw new Error('unavailable'); });
  const onClose = vi.fn();
  state.refs = [];
  state.set.mockImplementation((value: number) => { state.cursor = value; });
  const render = () => {
    state.index = 0;
    state.effects.length = 0;
    state.refIndex = 0;
    return SearchDialog({
      chats: [
        { id: 'recent', title: 'Recent', messages: [], updatedAt: 2 },
        { id: 'older', title: 'Older', messages: [], updatedAt: 1 },
      ] as any,
      onSelect, onNewChat: vi.fn(), onClose,
    });
  };
  const view = render();
  const list = view.props.children.props.children.find((child: any) => child?.props?.role === 'listbox');
  const options = list.props.children.flat().filter((child: any) => child?.props?.role === 'option');
  // Direct assistive-technology activation has no preceding pointer hover.
  options[1].props.onClick({ defaultPrevented: false });
  expect(onSelect).toHaveBeenLastCalledWith('older');
  expect(onClose).not.toHaveBeenCalled();
  state.setError.mockClear();
  const retry = render();
  state.effects[1].run();
  expect(state.setError).not.toHaveBeenCalled();
  expect(findInput(retry)!.props['aria-activedescendant']).toBe('search-1');
  findInput(retry)!.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() });
  expect(onSelect).toHaveBeenNthCalledWith(2, 'older');
  expect(onClose).toHaveBeenCalledOnce();
});

it('explains failed new-chat creation accurately and keeps keyboard retry available', () => {
  const onNewChat = vi.fn().mockImplementationOnce(() => { throw new Error('private storage failure'); });
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const focus = vi.fn();
  state.refs = [{ current: null }, { current: { focus } }, { current: undefined }];
  state.setError.mockImplementation((value: string) => { state.error = value; });
  const render = () => {
    state.index = 0;
    state.refIndex = 0;
    return SearchDialog({ chats: [], onNewChat, onSelect, onClose });
  };
  const pressEnter = (view: any) => findInput(view)!.props.onKeyDown({
    key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(),
  });
  pressEnter(render());
  expect(onNewChat).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalledOnce();
  const failed = render();
  const alert = failed.props.children.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.children).toBe('Could not start a new chat. Try again.');
  expect(findInput(failed)!.props['aria-describedby']).toBe(alert.props.id);
  pressEnter(failed);
  expect(onNewChat).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  expect(state.error).toBe('');
});

it('keeps a conversation searchable and openable when its timestamp is outside the Date range', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const chat = { id: 'damaged-date', title: 'Retained conversation', messages: [], updatedAt: 1e20 };
  let view: ReturnType<typeof SearchDialog>;
  expect(() => { view = SearchDialog({ chats: [chat], onSelect, onClose, onNewChat: vi.fn() }); }).not.toThrow();
  const nodes: any[] = [];
  const visit = (node: any) => {
    if (!node?.props) return;
    nodes.push(node);
    [node.props.children].flat(Infinity).forEach(visit);
  };
  visit(view!);
  expect(nodes.some(node => node.type === 'time')).toBe(false);
  expect(nodes.some(node => node.props.children === 'Date unavailable')).toBe(true);
  const row = nodes.find(node => node.props.role === 'option');
  row.props.onClick({ defaultPrevented: false });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('damaged-date');
  expect(onClose).toHaveBeenCalledOnce();
});

it('preserves the search draft when option activation was already cancelled', () => {
  state.query = 'Saved';
  const onSelect = vi.fn();
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const view = SearchDialog({
    chats: [{ id: 'saved', title: 'Saved conversation', messages: [], updatedAt: 1 }] as any,
    onSelect, onNewChat, onClose,
  });
  const list = view.props.children.props.children.find((child: any) => child?.props?.role === 'listbox');
  const options = list.props.children.flat().filter((child: any) => child?.props?.role === 'option');
  for (const option of options) option.props.onClick({ defaultPrevented: true });
  expect(onSelect).not.toHaveBeenCalled();
  expect(onNewChat).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(state.setError).not.toHaveBeenCalled();
  expect(findInput(view)!.props.value).toBe('Saved');
  options[0].props.onClick({ defaultPrevented: false });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('saved');
  expect(onClose).toHaveBeenCalledOnce();
});

it('retains the search query and retry feedback when clear activation was consumed', () => {
  state.query = 'Saved conversation';
  state.error = 'Could not open this conversation. Try again.';
  const onClose = vi.fn();
  const view = SearchDialog({ chats: [], onSelect: vi.fn(), onNewChat: vi.fn(), onClose });
  const focus = vi.fn();
  (findInput(view) as any).ref.current = { focus };
  const wrap = view.props.children.props.children[0];
  const clear = wrap.props.children.find((child: any) => child?.props?.['aria-label'] === 'Clear search');
  clear.props.onClick({ defaultPrevented: true });
  expect(state.set).not.toHaveBeenCalled();
  expect(state.setError).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(findInput(view)!.props.value).toBe('Saved conversation');
  expect(findInput(view)!.props['aria-describedby']).toBe('search-error');
  expect(onClose).not.toHaveBeenCalled();
  clear.props.onClick({ defaultPrevented: false });
  expect(state.set).toHaveBeenCalledWith('');
  expect(state.set).toHaveBeenCalledWith(0);
  expect(state.setError).toHaveBeenCalledWith('');
  expect(focus).toHaveBeenCalledOnce();
});
