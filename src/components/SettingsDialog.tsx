import { useEffect, useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import type { Preferences, Theme } from '../lib/preferences';
import { THEMES } from '../lib/preferences';
import type { Subscriptions } from '../lib/subscriptions';
import { PROVIDERS, setPlan } from '../lib/subscriptions';
import type { ChatGPTAccount } from '../lib/useChatGPT';
import type { ClaudeAccount } from '../lib/useClaude';
import { ChatGPTConnection, ChatGPTStatusLine } from './ChatGPTAccount';
import { ClaudeConnection, ClaudeStatusLine } from './ClaudeAccount';
import { CloseIcon, SmallPlusIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import { ToolsPanel } from './ToolsPanel';
import './SettingsDialog.css';

export const SETTINGS_SECTIONS = ['General', 'Personalization', 'Subscriptions', 'Tools', 'Data controls'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

interface Props {
  subscriptions: Subscriptions;
  onChange: (s: Subscriptions) => void;
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
}

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' };

const DESCRIPTIONS: Record<SettingsSection, string> = {
  General: 'How Jarvis looks and what it calls you.',
  Personalization: 'Instructions every new chat follows, in addition to project instructions.',
  Subscriptions: 'Add the AI plans you already pay for. Jarvis will route models through these instead of separate API billing.',
  Tools: 'MCP servers and skills every model in Jarvis can use, ChatGPT and Claude alike.',
  'Data controls': 'Everything is stored on this device only.',
};

/** Two-step destructive button: first click arms, second confirms. */
function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className="text-btn danger bordered"
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
  subscriptions,
  onChange,
  chatgpt,
  claude,
}: Pick<Props, 'subscriptions' | 'onChange' | 'chatgpt' | 'claude'>) {
  // A provider counts once it is signed in or has a plan recorded.
  const linked = (id: string) =>
    !!subscriptions[id] ||
    (id === 'openai' && chatgpt.state.phase === 'connected') ||
    (id === 'anthropic' && claude.state.phase === 'connected');
  const count = PROVIDERS.filter((p) => linked(p.id)).length;
  return (
    <>
      <ul className="provider-list">
        {PROVIDERS.map((p) => {
          const plan = subscriptions[p.id];
          const isChatGPT = p.id === 'openai';
          const isClaude = p.id === 'anthropic';
          const planSelect = plan && (
            <label className="plan-select">
              <span className="sr-only">{p.name} plan</span>
              <select value={plan} onChange={(e) => onChange(setPlan(subscriptions, p.id, e.target.value))}>
                {p.plans.map((pl) => (
                  <option key={pl} value={pl}>
                    {pl}
                  </option>
                ))}
              </select>
            </label>
          );
          return (
            <li key={p.id} className={`provider-row${plan ? ' added' : ''}`}>
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
                    plan && <span className="status-dot">Not connected</span>
                  )}
                </span>
              </div>
              {isChatGPT ? (
                <div className="provider-actions">
                  {planSelect}
                  <ChatGPTConnection account={chatgpt} />
                </div>
              ) : isClaude ? (
                <div className="provider-actions">
                  <ClaudeConnection account={claude} />
                </div>
              ) : plan ? (
                <div className="provider-actions">
                  {planSelect}
                  <button className="text-btn danger" onClick={() => onChange(setPlan(subscriptions, p.id, null))}>
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="add-btn"
                  onClick={() => onChange(setPlan(subscriptions, p.id, p.plans.find((x) => x !== 'Free') ?? p.plans[0]))}
                >
                  <SmallPlusIcon />
                  Add
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <footer className="dialog-footnote">
        <span className="mono">
          {count} of {PROVIDERS.length} connected
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const archived = props.chats.filter((c) => c.archived);
  const saved = props.chats.filter((c) => !c.temporary);

  // Settings edits re-render the parent with a new onClose; read it through a ref so focus isn't reset each keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef}>
        <nav className="dialog-nav">
          <h2 id="settings-title">Settings</h2>
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s} className={`dialog-nav-item${s === section ? ' active' : ''}`} onClick={() => setSection(s)}>
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
            <button className="icon-btn" title="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>

          {section === 'General' && (
            <div className="settings-rows">
              <label className="settings-row">
                <span>Theme</span>
                <span className="segmented" role="radiogroup">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={prefs.theme === t}
                      className={prefs.theme === t ? 'on' : ''}
                      onClick={() => setPrefs({ ...prefs, theme: t })}
                    >
                      {THEME_LABELS[t]}
                    </button>
                  ))}
                </span>
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

          {section === 'Subscriptions' && <SubscriptionsPanel subscriptions={props.subscriptions} onChange={props.onChange} chatgpt={props.chatgpt} claude={props.claude} />}

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
                <ConfirmButton label="Archive all" onConfirm={props.onArchiveAll} />
              </div>
              <div className="settings-row">
                <span>Delete all chats</span>
                <ConfirmButton label="Delete all" onConfirm={props.onDeleteAll} />
              </div>
              <div className="settings-stack">
                <span>Archived chats ({archived.length})</span>
                {archived.length === 0 ? (
                  <span className="settings-hint">Archived chats leave the sidebar but stay searchable here.</span>
                ) : (
                  <ul className="archived-list">
                    {archived.map((c) => (
                      <li key={c.id}>
                        <span className="history-title">{c.title}</span>
                        <button className="text-btn" onClick={() => props.onUnarchive(c.id)}>
                          Unarchive
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
