import { useState } from 'react';
import { openExternal } from '../lib/desktop';
import type { ChatGPTAccount } from '../lib/useChatGPT';
import { CloseIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import './ChatGPTAccount.css';

// Wording follows OpenAI's "Sign in with ChatGPT" UI/UX guidelines.
const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';
const OFFER_TEXT = 'Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.';
const BANNER_DISMISSED_KEY = 'jarvis.chatgptBannerDismissed';

const ChatGPTLogo = ({ size = 16 }: { size?: number }) => (
  <SiteIcon site="chatgpt.com" size={size} fallback={null} />
);

export function ContinueWithChatGPT({ account, compact }: { account: ChatGPTAccount; compact?: boolean }) {
  return (
    <button className={`cwc-btn${compact ? ' compact' : ''}`} onClick={() => void account.signIn()}>
      <ChatGPTLogo />
      Continue with ChatGPT
    </button>
  );
}

/** Settings row actions for the ChatGPT provider. */
export function ChatGPTConnection({ account }: { account: ChatGPTAccount }) {
  const { state } = account;
  if (state.phase === 'unavailable') {
    return <span className="connect-note">Open the Jarvis desktop app to connect</span>;
  }
  if (state.phase === 'loading') return <span className="connect-note">Checking…</span>;
  if (state.phase === 'signing-in') {
    return (
      <div className="connect-actions">
        <span className="connect-note pulsing">Finish signing in in your browser…</span>
        <button className="text-btn" onClick={account.cancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (state.phase === 'connected') {
    return (
      <div className="connect-actions">
        <button className="text-btn" onClick={() => openExternal(MANAGE_USAGE_URL)}>
          Manage usage
        </button>
        <button className="text-btn danger" onClick={() => void account.signOut()}>
          Sign out
        </button>
      </div>
    );
  }
  return <ContinueWithChatGPT account={account} compact />;
}

/** One-line status under the ChatGPT provider name. */
export function ChatGPTStatusLine({ account }: { account: ChatGPTAccount }) {
  const { state } = account;
  if (state.phase === 'connected') {
    return <span className="status-dot connected">{state.email ?? 'Connected'}</span>;
  }
  if (state.phase === 'signed-out' && state.error) return <span className="connect-error">{state.error}</span>;
  return <span className="status-dot">Not connected</span>;
}

/** First-sign-in disclosure required by OpenAI's guidelines. */
export function ChatGPTWelcome({ account }: { account: ChatGPTAccount }) {
  if (!account.showWelcome) return null;
  return (
    <div className="dialog-backdrop">
      <div className="welcome-card" role="dialog" aria-modal="true" aria-labelledby="cwc-welcome-title">
        <ChatGPTLogo size={28} />
        <h3 id="cwc-welcome-title">You're using your ChatGPT plan</h3>
        <p>Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.</p>
        <button className="cwc-btn" autoFocus onClick={account.dismissWelcome}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Prompt on the start screen until the user connects or dismisses it. */
export function ChatGPTConnectBanner({ account }: { account: ChatGPTAccount }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { state } = account;
  if (dismissed || state.phase === 'connected' || state.phase === 'loading' || state.phase === 'unavailable') {
    return null;
  }
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // Non-critical.
    }
  };
  return (
    <div className="cwc-banner">
      <div className="cwc-banner-text">
        <strong>Use your ChatGPT plan in Jarvis</strong>
        <span>{state.phase === 'signed-out' && state.error ? state.error : OFFER_TEXT}</span>
      </div>
      {state.phase === 'signing-in' ? (
        <span className="connect-note pulsing">Waiting for browser…</span>
      ) : (
        <ContinueWithChatGPT account={account} compact />
      )}
      <button className="icon-btn" title="Dismiss" onClick={dismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** "Using ChatGPT plan" note near the composer while an OpenAI model is selected. */
export function ChatGPTPlanNote() {
  return (
    <div className="plan-note">
      <ChatGPTLogo size={12} />
      Using ChatGPT plan
      <span aria-hidden="true">·</span>
      <button onClick={() => openExternal(MANAGE_USAGE_URL)}>Manage usage</button>
    </div>
  );
}
