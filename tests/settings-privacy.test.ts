import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { DEFAULT_PREFERENCES } from '../src/lib/preferences';

vi.mock('../src/lib/desktop', () => ({ isMac: () => true, openExternal: () => {} }));

vi.mock('../src/components/useDialog', () => ({ useDialog: () => {} }));

it('explains local storage and provider processing in Data controls', () => {
  const noop = () => {};
  const props = {
    initialSection: 'Data controls', preferences: DEFAULT_PREFERENCES, subscriptions: {}, chats: [],
    onChange: noop, onPreferencesChange: noop, onUnarchive: noop, onArchiveAll: noop,
    onDeleteAll: noop, onExportAll: noop, onClose: noop,
    ...Object.fromEntries(['chatgpt', 'claude', 'gemini', 'grok'].map((provider) => [provider, { state: { phase: 'unavailable' } }])),
  } as unknown as ComponentProps<typeof SettingsDialog>;
  const html = renderToStaticMarkup(createElement(SettingsDialog, props));
  expect(html).toContain('Saved chats and shared memory are stored on this device.');
  expect(html).toContain('Messages, attachments, and relevant conversation or memory context are sent to the provider you use.');
  expect(html).toContain('Provider data policies and account usage limits apply.');
  expect(html).not.toContain('Everything is stored on this device only.');
});
