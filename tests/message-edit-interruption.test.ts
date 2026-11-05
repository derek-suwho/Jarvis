import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slot: 0, setters: Array.from({ length: 5 }, () => vi.fn()), effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'edit-error',
  useState: () => {
    const slot = state.slot++;
    return [[true, 'Revised instruction', false, '', false][slot], state.setters[slot]];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), ''] }));
import { MessageItem } from '../src/components/MessageItem';

afterEach(() => { state.slot = 0; state.effects.length = 0; vi.clearAllMocks(); });

it.each(['success', 'failure'])('ignores pending edit %s after the message view unmounts', async (outcome) => {
  let resolve!: (saved: boolean) => void;
  const onEdit = vi.fn(() => new Promise<boolean>((finish) => { resolve = finish; }));
  const view = MessageItem({ message: { id: 'user-1', role: 'user', content: 'Original' },
    streaming: false, isLast: false, busy: false, onEdit });
  const cleanups = state.effects.map((effect) => effect());
  const actions = view.props.children.props.children.find((child: any) => child?.props?.className === 'edit-actions');
  const pending = actions.props.children[1].props.onClick();
  expect(onEdit).toHaveBeenCalledExactlyOnceWith('user-1', 'Revised instruction');
  expect(state.setters[4]).toHaveBeenCalledWith(true);
  cleanups.forEach((cleanup) => { if (cleanup) cleanup(); });
  state.setters.forEach((setter) => setter.mockClear());
  resolve(outcome === 'success');
  await pending;
  state.setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
});
