import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ index: 0, view: 'preview', setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => { const set = vi.fn(); state.setters.push(set); return [[ state.view, false ][state.index++], set]; },
  useRef: (current: unknown) => ({ current }), useEffect: () => {}, useId: () => 'artifact-test',
}));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), null] }));
import { Artifact } from '../src/components/Artifact';
afterEach(() => { state.index = 0; state.view = 'preview'; state.setters.length = 0; });
function tabs(node: ReactElement<any>): ReactElement<any>[] {
  if (node.props.role === 'tab') return [node];
  return [node.props.children].flat(Infinity).flatMap(child => child && typeof child === 'object' && 'props' in child ? tabs(child) : []);
}
it('provides one artifact tab stop and selects/focuses tabs with arrows, Home and End', () => {
  const controls = tabs(Artifact({ kind: 'svg', text: '<svg/>', streaming: false }));
  expect(controls.map(tab => tab.props.tabIndex)).toEqual([0, -1]);
  const focus = [vi.fn(), vi.fn()];
  controls.forEach((tab, index) => { (tab as unknown as { ref: { current: unknown } }).ref.current = { focus: focus[index] }; });
  for (const [index, key, target] of [[0, 'ArrowRight', 1], [0, 'ArrowLeft', 1], [1, 'Home', 0], [0, 'End', 1]] as const) {
    const preventDefault = vi.fn();
    controls[index].props.onKeyDown({ key, nativeEvent: {}, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.setters[0]).toHaveBeenLastCalledWith(target === 0 ? 'preview' : 'code');
    expect(focus[target]).toHaveBeenCalled();
  }
  state.setters[0].mockClear();
  controls[0].props.onKeyDown({ key: 'ArrowRight', nativeEvent: { isComposing: true }, preventDefault: vi.fn() });
  expect(state.setters[0]).not.toHaveBeenCalled();
});

function elements(node: ReactElement<any>): ReactElement<any>[] {
  return [node, ...[node.props.children].flat(Infinity).flatMap(child => child && typeof child === 'object' && 'props' in child ? elements(child) : [])];
}
it.each(['preview', 'code'])('associates the %s artifact panel with its selected tab and makes content keyboard reachable', view => {
  state.view = view;
  const nodes = elements(Artifact({ kind: 'svg', text: '<svg/>', streaming: false }));
  const controls = nodes.filter(node => node.props.role === 'tab');
  const panel = nodes.find(node => node.props.role === 'tabpanel');
  expect(panel).toBeDefined();
  const selected = controls.find(tab => tab.props['aria-selected']);
  expect(selected?.props.id).toBeTruthy();
  expect(panel!.props['aria-labelledby']).toBe(selected!.props.id);
  expect(panel!.props.id).toBeTruthy();
  expect(controls.map(tab => tab.props['aria-controls'])).toEqual([panel!.props.id, panel!.props.id]);
  expect(panel!.props.tabIndex).toBe(0);
});
