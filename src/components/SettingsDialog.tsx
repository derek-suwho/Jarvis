import { useEffect, useRef } from 'react';
import type { Subscriptions } from '../lib/subscriptions';
import { PROVIDERS, setPlan } from '../lib/subscriptions';
import type { ChatGPTAccount } from '../lib/useChatGPT';
import { ChatGPTConnection, ChatGPTStatusLine } from './ChatGPTAccount';
import { CloseIcon, SmallPlusIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import './SettingsDialog.css';

interface Props {
  subscriptions: Subscriptions;
  onChange: (s: Subscriptions) => void;
  onClose: () => void;
  chatgpt: ChatGPTAccount;
}

export function SettingsDialog({ subscriptions, onChange, onClose, chatgpt }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const count = Object.keys(subscriptions).length;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <nav className="dialog-nav">
          <h2 id="settings-title">Settings</h2>
          <button className="dialog-nav-item active">Subscriptions</button>
        </nav>

        <section className="dialog-body">
          <header className="dialog-header">
            <div>
              <h3>Subscriptions</h3>
              <p>
                Add the AI plans you already pay for. Jarvis will route models through these instead of separate API
                billing.
              </p>
            </div>
            <button className="icon-btn" title="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>

          <ul className="provider-list">
            {PROVIDERS.map((p) => {
              const plan = subscriptions[p.id];
              const isChatGPT = p.id === 'openai';
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
                    <span className="provider-name">{p.name}</span>
                    <span className="provider-meta">
                      {p.company}
                      {isChatGPT ? (
                        <ChatGPTStatusLine account={chatgpt} />
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
                      onClick={() =>
                        onChange(setPlan(subscriptions, p.id, p.plans.find((x) => x !== 'Free') ?? p.plans[0]))
                      }
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
              {count} of {PROVIDERS.length} added
            </span>
            <span>
              Jarvis never sees your passwords. ChatGPT sign-in happens in your browser and its tokens stay on this
              device. Claude, Gemini and Grok connections are coming.
            </span>
          </footer>
        </section>
      </div>
    </div>
  );
}
