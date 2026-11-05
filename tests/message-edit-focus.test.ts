import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ editing: false, draft: 'Original', index: 0, refIndex: 0, refs: [] as { current: any }[], effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'test-edit-error',
  useState: () => {
    const index = state.index++;
    return index === 0 ? [state.editing, (value: boolean) => { state.editing = value; }] : index === 1 ? [state.draft, vi.fn()] : [false, vi.fn()];
  },
  useRef: (current: unknown) => state.refs[state.refIndex++] ?? (state.refs[state.refIndex - 1] = { current }),
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), null] }));
import { MessageItem } from '../src/components/MessageItem';
function find(node: ReactElement<any>, match: (node: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (match(node)) return node;
  return [node.props.children].flat(Infinity).filter(child => child && typeof child === 'object' && 'props' in child).map(child => find(child, match)).find(Boolean);
}
function render(busy = false, onEdit = vi.fn()) {
  state.index = 0; state.refIndex = 0; state.effects = [];
  return MessageItem({ message: { id: 'u', role: 'user', content: 'Original' }, streaming: false, isLast: false, busy, onEdit });
}
afterEach(() => { state.editing = false; state.draft = 'Original'; state.refs = []; });
it.each(['Cancel', 'Escape', 'Send'])('returns focus to Edit message after %s and does not reclaim it on later renders', (method) => {
  find(render(), node => node.props.title === 'Edit message')!.props.onClick();
  const editing = render();
  if (method === 'Escape') find(editing, node => node.type === 'textarea')!.props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  else find(editing, node => node.type === 'button' && node.props.children === method)!.props.onClick();
  const action = find(render(), node => node.props.title === 'Edit message')!;
  // Render the action component to inspect the native button ref.
  const button = (action.type as any)(action.props);
  const ref = (button as any).ref;
  expect(ref).toBeTruthy();
  const focus = vi.fn();
  ref.current = { focus };
  state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
  render(); state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
});

it('focuses Copy when sending a changed edit starts a reply and does not reclaim focus when it finishes', () => {
  find(render(), node => node.props.title === 'Edit message')!.props.onClick();
  state.draft = 'Changed instruction';
  const onEdit = vi.fn();
  const editing = render(false, onEdit);
  find(editing, node => node.type === 'button' && node.props.children === 'Send')!.props.onClick();
  expect(onEdit).toHaveBeenCalledWith('u', 'Changed instruction');
  // React removes the unavailable Edit control before running effects.
  state.refs.forEach(ref => { if (ref.current && typeof ref.current === 'object') ref.current = null; });
  const replying = render(true);
  expect(find(replying, node => node.props.title === 'Edit message')).toBeUndefined();
  const action = find(replying, node => node.props.title === 'Copy')!;
  const button = (action.type as any)(action.props);
  const ref = (button as any).ref;
  expect(ref).toBeTruthy();
  const focus = vi.fn();
  ref.current = { focus };
  state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
  render(false); state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
});
