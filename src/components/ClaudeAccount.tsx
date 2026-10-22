import { useState } from 'react';
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
      return (
        <button className="add-btn" onClick={() => openExternal(INSTALL_URL)}>
          Install Claude Code
        </button>
      );
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

/**
 * Jarvis has no Claude login of its own: it uses the Claude Code login already on this Mac,
 * so signing out here signs out Claude Code everywhere (including the terminal). Two clicks to confirm.
 */
function ClaudeSignOut({ account }: { account: ClaudeAccount }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="connect-actions">
      {armed && <span className="connect-note">Also signs out Terminal</span>}
      <button
        className="text-btn danger"
        title="Signs out Claude Code on this Mac, including the claude command in Terminal"
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          void account.signOut();
        }}
      >
        {armed ? 'Confirm sign out' : 'Sign out'}
      </button>
    </div>
  );
}

/** One-line status under the Claude provider name. */
export function ClaudeStatusLine({ account }: { account: ClaudeAccount }) {
  const { state } = account;
  if (state.phase === 'connected') {
    const plan = state.plan ? ` · ${state.plan[0].toUpperCase()}${state.plan.slice(1)}` : '';
    const text = `${state.email ?? 'Connected'}${plan} · Claude Code login on this Mac`;
    return (
      <span
        className="status-dot connected"
        title="Jarvis uses the Claude Code login already on this Mac and never sees your credentials."
      >
        <span className="status-text">{text}</span>
      </span>
    );
  }
  if (state.phase === 'not-installed') return <span className="status-dot">Claude Code not found</span>;
  if (state.phase === 'signed-out' && state.error) {
    return <span className="connect-error status-text" title={state.error}>{state.error}</span>;
  }
  return <span className="status-dot">Not connected</span>;
}
