import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: any }>, index: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { ResizeHandle } from '../src/components/ResizeHandle';

afterEach(() => {
  hooks.refs = []; hooks.index = 0; hooks.effects = [];
  vi.unstubAllGlobals();
});

it('cancels a drag through the current resize callback after rerender', () => {
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, handler: any) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  const previousResize = vi.fn();
  const currentResize = vi.fn();
  const render = (onResize: (width: number) => void) => {
    hooks.index = 0;
    return ResizeHandle({ label: 'Sidebar width', edge: 'right', measure: () => 280, onResize, onReset: vi.fn() });
  };
  render(previousResize);
  const cleanups = hooks.effects.map(effect => effect());
  try {
    const handle = render(currentResize);
    const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    handle.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, currentTarget: target, preventDefault: vi.fn() });
    handle.props.onPointerMove({ pointerId: 1, clientX: 140, buttons: 1 });
    expect(currentResize).toHaveBeenLastCalledWith(320);
    listeners.get('keydown')!({ key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(currentResize).toHaveBeenLastCalledWith(280);
    expect(previousResize).not.toHaveBeenCalled();
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    currentResize.mockClear();
    handle.props.onPointerUp({ pointerId: 1, clientX: 160 });
    expect(currentResize).not.toHaveBeenCalled();
  } finally { cleanups.forEach(cleanup => cleanup?.()); }
  expect(listeners.size).toBe(0);
});
