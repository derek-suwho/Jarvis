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
      return <span className="connect-note">Via Claude Code</span>;
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

/** One-line status under the Claude provider name. */
export function ClaudeStatusLine({ account }: { account: ClaudeAccount }) {
  const { state } = account;
  if (state.phase === 'connected') {
    const plan = state.plan ? ` · ${state.plan[0].toUpperCase()}${state.plan.slice(1)}` : '';
    return <span className="status-dot connected">{(state.email ?? 'Connected') + plan}</span>;
  }
  if (state.phase === 'not-installed') return <span className="status-dot">Claude Code not found</span>;
  if (state.phase === 'signed-out' && state.error) return <span className="connect-error">{state.error}</span>;
  return <span className="status-dot">Not connected</span>;
}
