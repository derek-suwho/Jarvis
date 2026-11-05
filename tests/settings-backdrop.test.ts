import { expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/preferences';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('../src/components/useDialog', () => ({ useDialog: vi.fn() }));
vi.mock('../src/lib/desktop', () => ({ isMac: () => false, openExternal: vi.fn() }));
import { SettingsDialog } from '../src/components/SettingsDialog';

it('keeps Settings open for context-menu and consumed backdrop presses while allowing primary dismissal', () => {
  const onClose = vi.fn();
  const noop = vi.fn();
  const view = SettingsDialog({
    preferences: DEFAULT_PREFERENCES, subscriptions: {}, chats: [],
    onChange: noop, onPreferencesChange: noop, onUnarchive: noop, onArchiveAll: noop,
    onDeleteAll: noop, onExportAll: noop, onClose,
    ...Object.fromEntries(['chatgpt', 'claude', 'gemini', 'grok'].map((key) => [key, { state: { phase: 'unavailable' } }])),
  } as any);
  const backdrop = {};
  const press = { target: backdrop, currentTarget: backdrop, button: 0, defaultPrevented: false };
  view.props.onMouseDown({ ...press, button: 2 });
  view.props.onMouseDown({ ...press, button: 1 });
  view.props.onMouseDown({ ...press, defaultPrevented: true });
  view.props.onMouseDown({ ...press, target: {} });
  expect(onClose).not.toHaveBeenCalled();
  view.props.onMouseDown(press);
  expect(onClose).toHaveBeenCalledOnce();
});
