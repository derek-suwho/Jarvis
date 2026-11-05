import { afterEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void> }));
vi.mock('react', () => ({
  useState: (initial: () => unknown) => [initial(), vi.fn()],
  useEffect: (effect: () => void) => lifecycle.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
import { useStoredWidth } from '../src/components/ResizeHandle';

afterEach(() => {
  lifecycle.effects.length = 0;
  vi.unstubAllGlobals();
});

it('restores the default panel layout and removes a nonfinite saved width', () => {
  const removeItem = vi.fn();
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => 'Infinity', removeItem, setItem });
  const [width] = useStoredWidth('sidebar-width', 180, 480);
  expect(width).toBeNull();
  lifecycle.effects.forEach(effect => effect());
  expect(removeItem).toHaveBeenCalledExactlyOnceWith('sidebar-width');
  expect(setItem).not.toHaveBeenCalled();
});

it.each([['260.4', 260], ['900', 480], ['100', 180]])('preserves finite saved width %s within panel bounds', (saved, expected) => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => saved, removeItem: vi.fn(), setItem });
  const [width] = useStoredWidth('sidebar-width', 180, 480);
  expect(width).toBe(expected);
  lifecycle.effects.forEach(effect => effect());
  expect(setItem).toHaveBeenCalledExactlyOnceWith('sidebar-width', String(expected));
});
