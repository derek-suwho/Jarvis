import { useEffect, useRef, useState } from 'react';
import { openExternal } from '../lib/desktop';
import type { ClaudeAccount } from '../lib/useClaude';

const INSTALL_URL = 'https://claude.com/claude-code';

/** Settings row actions for Claude (through the user's own Claude Code). */
export function ClaudeConnection({ account }: { account: ClaudeAccount }) {
  const { state } = account;
  switch (state.phase) {
    case 'unavailable':
      return <span className="connect-note">Open the Jarvis desktop app to connect</span>;
    case 'loading':
      return <span className="connect-note">Checking…</span>;
    case 'not-installed':
      return <ClaudeInstall />;
    case 'connected':
      return <ClaudeSignOut account={account} />;
    case 'signed-out':
      return state.waiting ? (
        <div className="connect-actions">
          <span className="connect-note pulsing">Finish signing in in Terminal…</span>
          <button className="text-btn" onClick={() => void account.refresh()}>
            Check
          </button>
        </div>
      ) : (
        <button className="add-btn" onClick={() => void account.signIn()}>
          Sign in with Claude Code
        </button>
      );
  }
}

function ClaudeInstall() {
  const [error, setError] = useState('');
  return (
    <div className="connect-actions">
      <button className="add-btn" onClick={() => {
        setError('');
        return openExternal(INSTALL_URL, setError);
      }}>
        Install Claude Code
      </button>
      {error && <span className="connect-error status-text" role="alert">{error}</span>}
    </div>
  );
}

/**
 * Jarvis has no Claude login of its own: it uses the Claude Code login already on this Mac,
 * so signing out here signs out Claude Code everywhere (including the terminal). Two clicks to confirm.
 */
function ClaudeSignOut({ account }: { account: ClaudeAccount }) {
  const [armed, setArmed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return (
    <div className="connect-actions">
      {armed && <span className="connect-note">Also signs out Terminal</span>}
      <button
        className="text-btn danger account-action"
        disabled={signingOut}
        title="Signs out Claude Code on this Mac, including the claude command in Terminal"
        onBlur={() => setArmed(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && armed) {
            event.preventDefault();
            event.stopPropagation();
            setArmed(false);
            return;
          }
          if ((event.key === 'Enter' || event.key === ' ')
            && (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229)) {
            event.preventDefault();
          }
        }}
        onClick={async () => {
          if (!armed) return setArmed(true);
          setArmed(false);
          setSigningOut(true);
          try { await account.signOut(); }
          finally { if (mounted.current) setSigningOut(false); }
        }}
      >
        {signingOut ? 'Signing out…' : armed ? 'Confirm sign out' : 'Sign out'}
      </button>
    </div>
  );
}

/** One-line status under the Claude provider name. */
export function ClaudeStatusLine({ account }: { account: ClaudeAccount }) {
  const { state } = account;
  if (state.phase === 'connected') {
    if (state.notice) {
      return <span className="connect-error status-text" role="alert" title={state.notice}>{state.notice}</span>;
    }
    const plan = state.plan ? ` · ${state.plan[0].toUpperCase()}${state.plan.slice(1)}` : '';
    const text = `${state.email ?? 'Connected'}${plan} · Claude Code login on this Mac`;
    return (
      <span
        className="status-dot connected"
        role="status"
        title="Jarvis uses the Claude Code login already on this Mac and never sees your credentials."
      >
        <span className="status-text">{text}</span>
      </span>
    );
  }
  if (state.phase === 'not-installed') return <span className="status-dot" role="status">Claude Code not found</span>;
  if (state.phase === 'signed-out' && state.error) {
    return <span className="connect-error status-text" role="alert" title={state.error}>{state.error}</span>;
  }
  const message = state.phase === 'loading' ? 'Checking connection…'
    : state.phase === 'unavailable' ? 'Desktop app required'
    : state.phase === 'signed-out' && state.waiting ? 'Waiting for Terminal sign-in…'
    : 'Not connected';
  return <span className="status-dot" role="status">{message}</span>;
}
