import { afterEach, expect, it, vi } from 'vitest';
import type { ClaudeAccount } from '../src/lib/useClaude';

const state = vi.hoisted(() => ({ error: '' }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [state.error, (value: string) => { state.error = value; }],
}));
vi.mock('../src/lib/desktop', () => ({ openExternal: vi.fn() }));
import { ClaudeConnection } from '../src/components/ClaudeAccount';
import { openExternal } from '../src/lib/desktop';

function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (typeof node.type === 'function') return find(node.type(node.props), predicate);
  if (predicate(node)) return node;
  return [node.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
}
afterEach(() => { state.error = ''; vi.clearAllMocks(); });

it('announces failed Claude setup handoffs and clears feedback on retry', async () => {
  const account = { state: { phase: 'not-installed' } } as ClaudeAccount;
  const render = () => ClaudeConnection({ account });
  vi.mocked(openExternal).mockImplementation(async (_url, notify) => {
    notify?.('Could not open in your browser. Try again.');
  });
  await find(render(), (node) => node.type === 'button').props.onClick();
  expect(openExternal).toHaveBeenLastCalledWith('https://claude.com/claude-code', expect.any(Function));
  expect(find(render(), (node) => node.props?.role === 'alert')?.props.children).toBe('Could not open in your browser. Try again.');
  vi.mocked(openExternal).mockResolvedValue(undefined);
  await find(render(), (node) => node.type === 'button').props.onClick();
  expect(find(render(), (node) => node.props?.role === 'alert')).toBeUndefined();
});
