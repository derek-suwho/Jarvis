import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ index: 0, close: vi.fn(), dialog: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [[ 'preview', true ][state.index++], state.close],
  useEffect: () => {}, useRef: (current: unknown) => ({ current }), useId: () => 'artifact-modal',
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('../src/components/useDialog', () => ({ useDialog: state.dialog }));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [false, vi.fn(), null] }));
import { Artifact } from '../src/components/Artifact';
afterEach(() => { state.index = 0; vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('gives expanded artifacts a named modal managed by the shared focus and Escape handler', () => {
  vi.stubGlobal('document', { body: {} });
  const tree = Artifact({ kind: 'svg', text: '<svg/>', streaming: false });
  const portal = tree.props.children[1] as ReactElement<any>;
  const card = typeof portal.type === 'function' ? (portal.type as (props: any) => ReactElement<any>)(portal.props) : portal;
  expect(card.props.role).toBe('dialog');
  expect(card.props['aria-modal']).toBe(true);
  expect(card.props['aria-label']).toBeTruthy();
  expect(card.props.tabIndex).toBe(-1);
  expect(state.dialog).toHaveBeenCalledOnce();
  expect(state.dialog.mock.calls[0][0]).toBe((card as unknown as { ref: unknown }).ref);
  state.dialog.mock.calls[0][1]();
  expect(state.close).toHaveBeenCalledWith(false);
});
