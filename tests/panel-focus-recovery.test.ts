import { afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ refs: [] as any[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current }),
  useLayoutEffect: (effect: () => void) => hooks.effects.push(effect),
}));
import { usePanelFocusRecovery } from '../src/lib/usePanelFocusRecovery';
afterEach(() => { hooks.refs = []; hooks.index = 0; hooks.effects = []; });

it('returns focus to the persistent action after the final workspace panel closes, without stealing focus on initial render', () => {
  const focus = vi.fn();
  const render = (open: boolean) => {
    hooks.index = 0;
    const target = usePanelFocusRecovery(open);
    Object.defineProperty(target, 'current', { value: { focus }, writable: true });
    hooks.effects.splice(0).forEach(effect => effect());
  };
  render(false);
  render(false);
  render(true);
  render(true);
  expect(focus).not.toHaveBeenCalled();
  render(false);
  expect(focus).toHaveBeenCalledOnce();
  render(false);
  expect(focus).toHaveBeenCalledOnce();
  render(true);
  render(false);
  expect(focus).toHaveBeenCalledTimes(2);
});
