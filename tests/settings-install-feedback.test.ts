import { expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/preferences';

const state = vi.hoisted(() => ({ error: '' }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial === '' ? state.error : initial, (value: string) => { state.error = value; }],
  useRef: () => ({ current: null }),
}));
vi.mock('../src/components/useDialog', () => ({ useDialog: vi.fn() }));
vi.mock('../src/lib/desktop', () => ({ isMac: () => false, openExternal: vi.fn() }));
import { SettingsDialog } from '../src/components/SettingsDialog';
import { openExternal } from '../src/lib/desktop';

function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  return [node.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
}

it('announces failed Gemini/Grok setup handoffs and clears feedback on retry', async () => {
  const noop = vi.fn();
  const view = SettingsDialog({
    initialSection: 'Subscriptions', preferences: DEFAULT_PREFERENCES, subscriptions: {}, chats: [],
    onChange: noop, onPreferencesChange: noop, onUnarchive: noop, onArchiveAll: noop,
    onDeleteAll: noop, onExportAll: noop, onClose: noop,
    ...Object.fromEntries(['chatgpt', 'claude', 'gemini', 'grok'].map((key) => [key, { state: { phase: 'not-installed' } }])),
  } as any);
  const panel = find(view, (node) => node.type?.name === 'SubscriptionsPanel');
  const render = () => panel.type(panel.props);
  try {
    for (const [provider, url] of [['google', 'https://antigravity.google/docs/install/'], ['xai', 'https://docs.x.ai/build/overview']]) {
      state.error = '';
      const install = () => find(find(render(), (node) => node.props?.['data-provider'] === provider), (node) => !!node.props?.onInstall);
      vi.mocked(openExternal).mockImplementation(async (_url, notify) => { notify?.('Could not open in your browser. Try again.'); });
      await install().props.onInstall();
      expect(openExternal).toHaveBeenLastCalledWith(url, expect.any(Function));
      expect(find(render(), (node) => node.props?.role === 'alert')?.props.children).toBe('Could not open in your browser. Try again.');
      vi.mocked(openExternal).mockResolvedValue(undefined);
      await install().props.onInstall();
      expect(find(render(), (node) => node.props?.role === 'alert')).toBeUndefined();
    }
  } finally { state.error = ''; }
});
