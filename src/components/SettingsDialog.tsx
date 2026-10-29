import { useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import type { Preferences, Theme } from '../lib/preferences';
import { THEMES } from '../lib/preferences';
import { PROVIDERS } from '../lib/subscriptions';
import type { ChatGPTAccount } from '../lib/useChatGPT';
import type { ClaudeAccount } from '../lib/useClaude';
import type { SubscriptionAccount } from '../lib/useSubscriptionAccount';
import { SubscriptionConnection, SubscriptionStatusLine } from './SubscriptionAccount';
import { ChatGPTConnection, ChatGPTStatusLine } from './ChatGPTAccount';
import { ClaudeConnection, ClaudeStatusLine } from './ClaudeAccount';
import { CloseIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import { ToolsPanel } from './ToolsPanel';
import { isMac, openExternal } from '../lib/desktop';
import { useDialog } from './useDialog';
import './SettingsDialog.css';

export const SETTINGS_SECTIONS = ['General', 'Personalization', 'Subscriptions', 'Tools', 'Data controls', 'Keyboard shortcuts'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

interface Props {
  preferences: Preferences;
  onPreferencesChange: (p: Preferences) => void;
  chats: Chat[];
  onUnarchive: (id: string) => void;
  onArchiveAll: () => void;
  onDeleteAll: () => void;
  onExportAll: () => void;
  initialSection?: SettingsSection;
  onClose: () => void;
  chatgpt: ChatGPTAccount;
  claude: ClaudeAccount;
  gemini: SubscriptionAccount;
  grok: SubscriptionAccount;
}

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' };

const DESCRIPTIONS: Record<SettingsSection, string> = {
  General: 'How Jarvis looks and what it calls you.',
  Personalization: 'Instructions every new chat follows, in addition to project instructions.',
  Subscriptions: 'View your connected accounts and subscription plans.',
  Tools: 'MCP servers and skills every model in Jarvis can use, ChatGPT and Claude alike.',
  'Data controls': 'Everything is stored on this device only.',
  'Keyboard shortcuts': 'Move around Jarvis without leaving the keyboard.',
};

/** Two-step destructive button: first click arms, second confirms. */
function ConfirmButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className="text-btn danger bordered"
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? 'Click again to confirm' : label}
    </button>
  );
}

function SubscriptionsPanel({
  chatgpt,
  claude,
  gemini,
  grok,
}: Pick<Props, 'chatgpt' | 'claude' | 'gemini' | 'grok'>) {
  const count = [chatgpt, claude, gemini, grok].filter((account) => account.state.phase === 'connected').length;
  return (
    <>
      <ul className="provider-list">
        {PROVIDERS.map((p) => {
          const isChatGPT = p.id === 'openai';
          const isClaude = p.id === 'anthropic';
          const extraAccount = p.id === 'google' ? gemini : p.id === 'xai' ? grok : null;
          const connected = isChatGPT ? chatgpt.state.phase === 'connected' : isClaude ? claude.state.phase === 'connected' : extraAccount?.state.phase === 'connected';
          return (
            <li key={p.id} data-provider={p.id} className={`provider-row${connected ? ' added' : ''}`}>
              <span className="provider-mark">
                <SiteIcon site={p.site} size={20} fallback={p.name[0]} />
              </span>
              <div className="provider-info">
                <span className="provider-name">
                  {p.name}
                  <span className="provider-company">{p.company}</span>
                </span>
                <span className="provider-meta">
                  {isChatGPT ? (
                    <ChatGPTStatusLine account={chatgpt} />
                  ) : isClaude ? (
                    <ClaudeStatusLine account={claude} />
                  ) : (
                    extraAccount && <SubscriptionStatusLine account={extraAccount} />
                  )}
                </span>
              </div>
              {isChatGPT ? (
                <div className="provider-actions">
                  <ChatGPTConnection account={chatgpt} />
                </div>
              ) : isClaude ? (
                <div className="provider-actions">
                  <ClaudeConnection account={claude} />
                </div>
              ) : (
                <div className="provider-actions">
                  {extraAccount && <SubscriptionConnection
                    account={extraAccount}
                    installLabel={`Set up ${p.name}`}
                    signOutNotice={p.id === 'google' ? 'Also signs out Antigravity CLI on this Mac' : undefined}
                    onInstall={() => openExternal(p.id === 'google' ? 'https://antigravity.google/docs/install/' : 'https://docs.x.ai/build/overview')}
                  />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <footer className="dialog-footnote">
        <span className="mono">
          {count} account{count === 1 ? '' : 's'} connected
        </span>
        <span>
          Jarvis never sees your passwords. Claude uses this Mac&rsquo;s Claude Code login, so it shares that plan&rsquo;s
          usage.
        </span>
      </footer>
    </>
  );
}

export function SettingsDialog(props: Props) {
  const { preferences: prefs, onPreferencesChange: setPrefs, onClose } = props;
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? 'General');
  const [archiveQuery, setArchiveQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const archived = props.chats.filter((c) => c.archived);
  const visibleArchived = archived.filter((chat) => chat.title.toLowerCase().includes(archiveQuery.trim().toLowerCase()));
  const saved = props.chats.filter((c) => !c.temporary);
  const modifier = isMac() ? '⌘' : 'Ctrl';
  const shortcuts = [
    ['New chat', `Shift + ${modifier} + O`],
    ['Search conversations', `${modifier} + K`],
    ['Toggle sidebar', `Shift + ${modifier} + S`],
    ['Open settings', `${modifier} + ,`],
    ['New browser tab', `Shift + ${modifier} + B`],
    ['New tab in full view', `Shift + ${modifier} + F`],
    ['Open a side chat', `${isMac() ? 'Option' : 'Alt'} + ${modifier} + S`],
    ['Add a new line', 'Shift + Enter'],
    ['Close a dialog or menu', 'Esc'],
  ];

  useDialog(dialogRef, onClose);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef}>
        <nav className="dialog-nav" aria-label="Settings sections">
          <h2 id="settings-title">Settings</h2>
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s} className={`dialog-nav-item${s === section ? ' active' : ''}`} aria-current={s === section ? 'page' : undefined} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </nav>

        <section className="dialog-body">
          <header className="dialog-header">
            <div>
              <h3>{section}</h3>
              <p>{DESCRIPTIONS[section]}</p>
            </div>
            <button className="icon-btn" title="Close settings" aria-label="Close settings" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>

          {section === 'General' && (
            <div className="settings-rows">
              <div className="settings-row">
                <span>Theme</span>
                <span className="segmented" role="radiogroup" aria-label="Theme">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={prefs.theme === t}
                      tabIndex={prefs.theme === t ? 0 : -1}
                      className={prefs.theme === t ? 'on' : ''}
                      onClick={() => setPrefs({ ...prefs, theme: t })}
                      onKeyDown={(event) => {
                        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const next = (THEMES.indexOf(t) + direction + THEMES.length) % THEMES.length;
                        setPrefs({ ...prefs, theme: THEMES[next] });
                        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
                      }}
                    >
                      {THEME_LABELS[t]}
                    </button>
                  ))}
                </span>
              </div>
              <label className="settings-row">
                <span>Desktop task notifications</span>
                <input type="checkbox" aria-label="Desktop task notifications" checked={prefs.desktopTaskNotifications}
                  onChange={(event) => setPrefs({ ...prefs, desktopTaskNotifications: event.target.checked })} />
              </label>
              <label className="settings-row">
                <span>What should Jarvis call you?</span>
                <input
                  className="settings-input"
                  placeholder="Your name"
                  maxLength={40}
                  value={prefs.name}
                  onChange={(e) => setPrefs({ ...prefs, name: e.target.value })}
                />
              </label>
            </div>
          )}

          {section === 'Personalization' && (
            <div className="settings-rows">
              <label className="settings-stack">
                <span>Custom instructions</span>
                <textarea
                  className="settings-textarea"
                  rows={8}
                  maxLength={1500}
                  placeholder="e.g. I'm a grad student in CS. Be concise, use metric units, and show code in TypeScript."
                  value={prefs.instructions}
                  onChange={(e) => setPrefs({ ...prefs, instructions: e.target.value })}
                />
                <span className="mono">{prefs.instructions.length} / 1500</span>
              </label>
            </div>
          )}

          {section === 'Subscriptions' && <SubscriptionsPanel chatgpt={props.chatgpt} claude={props.claude} gemini={props.gemini} grok={props.grok} />}

          {section === 'Tools' && <ToolsPanel />}

          {section === 'Data controls' && (
            <div className="settings-rows">
              <div className="settings-row">
                <span>Export all chats</span>
                <button className="add-btn" onClick={props.onExportAll} disabled={saved.length === 0}>
                  Export
                </button>
              </div>
              <div className="settings-row">
                <span>Archive all chats</span>
                <ConfirmButton label="Archive all" onConfirm={props.onArchiveAll} disabled={!saved.some((chat) => !chat.archived)} />
              </div>
              <div className="settings-row">
                <span>Delete all chats</span>
                <ConfirmButton label="Delete all" onConfirm={props.onDeleteAll} disabled={saved.length === 0} />
              </div>
              <div className="settings-stack">
                <span>Archived chats ({archived.length})</span>
                {archived.length === 0 ? (
                  <span className="settings-hint">Archived conversations stay saved and appear in search.</span>
                ) : (
                  <>
                  <input className="settings-input archive-search" aria-label="Search archived conversations" placeholder="Find an archived conversation" value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} />
                  <ul className="archived-list">
                    {visibleArchived.map((c) => (
                      <li key={c.id}>
                        <span className="history-title">{c.title}</span>
                        <button className="text-btn" onClick={() => props.onUnarchive(c.id)}>
                          Unarchive
                        </button>
                      </li>
                    ))}
                  </ul>
                  {visibleArchived.length === 0 && <span className="settings-hint">No archived conversations match.</span>}
                  </>
                )}
              </div>
            </div>
          )}
          {section === 'Keyboard shortcuts' && (
            <dl className="shortcut-list">
              {shortcuts.map(([label, shortcut]) => (
                <div key={label}><dt>{label}</dt><dd><kbd>{shortcut}</kbd></dd></div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
