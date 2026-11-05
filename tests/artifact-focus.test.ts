import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ expanded: false, index: 0, refIndex: 0, refs: [] as { current: any }[], effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => state.index++ === 0 ? ['preview', vi.fn()] : [state.expanded, (next: any) => { state.expanded = typeof next === 'function' ? next(state.expanded) : next; }],
  useRef: (current: unknown) => state.refs[state.refIndex++] ?? (state.refs[state.refIndex - 1] = { current }),
  useId: () => 'artifact-focus',
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), null] }));
import { Artifact } from '../src/components/Artifact';
function find(node: ReactElement<any>, label: string): ReactElement<any> | undefined {
  if (node.props['aria-label'] === label) return node;
  return [node.props.children].flat(Infinity).filter(child => child && typeof child === 'object' && 'props' in child).map(child => find(child, label)).find(Boolean);
}
function render() {
  state.index = 0; state.refIndex = 0; state.effects = [];
  return Artifact({ kind: 'svg', text: '<svg/>', streaming: false });
}
afterEach(() => { state.expanded = false; state.refs = []; vi.unstubAllGlobals(); });
it.each(['button', 'Escape'])('restores focus to the recreated inline expand control after closing via %s', (method) => {
  vi.stubGlobal('document', { body: {} });
  const initial = find(render(), 'Open full view')!;
  state.effects.forEach(effect => effect());
  initial.props.onClick();
  const expanded = render();
  state.effects.forEach(effect => effect());
  const modal = expanded.props.children[1];
  if (method === 'Escape') modal.props.onClose();
  else find(modal.props.card, 'Close full view')!.props.onClick();
  const inline = find(render(), 'Open full view')!;
  const focus = vi.fn();
  const ref = (inline as unknown as { ref: { current: unknown } }).ref;
  expect(ref).toBeTruthy();
  ref.current = { focus };
  state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
  // Ordinary subsequent renders must not reclaim focus.
  render();
  state.effects.forEach(effect => effect());
  expect(focus).toHaveBeenCalledOnce();
});
