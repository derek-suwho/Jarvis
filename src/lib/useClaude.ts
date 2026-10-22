import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaudeStatus } from './desktop';

export type ClaudeState =
  | { phase: 'unavailable' }
  | { phase: 'loading' }
  | { phase: 'not-installed' }
  | { phase: 'signed-out'; waiting: boolean; error?: string }
  | { phase: 'connected'; email: string | null; plan: string | null };

const POLL_MS = 2000;
const POLL_LIMIT_MS = 5 * 60 * 1000;

function fromStatus(s: ClaudeStatus): ClaudeState {
  if (!s.installed) return { phase: 'not-installed' };
  return s.connected ? { phase: 'connected', email: s.email, plan: s.plan } : { phase: 'signed-out', waiting: false };
}

/** Claude through the user's own Claude Code; sign-in happens in Claude Code's terminal login. */
export function useClaude() {
  const bridge = typeof window !== 'undefined' ? window.jarvis?.claude : undefined;
  const [state, setState] = useState<ClaudeState>(bridge ? { phase: 'loading' } : { phase: 'unavailable' });
  const poll = useRef<number | null>(null);

  const stopPolling = () => {
    if (poll.current !== null) window.clearInterval(poll.current);
    poll.current = null;
  };

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = fromStatus(await bridge.status());
      setState((prev) =>
        next.phase === 'signed-out' && prev.phase === 'signed-out' && prev.waiting ? prev : next,
      );
      if (next.phase === 'connected') stopPolling();
    } catch {
      setState({ phase: 'signed-out', waiting: false, error: 'Could not check Claude Code.' });
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      stopPolling();
    };
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (!bridge) return;
    const res = await bridge.signIn();
    if (!res.ok) {
      setState({ phase: 'signed-out', waiting: false, error: res.error });
      return;
    }
    // Claude Code's login runs in Terminal; watch for it to finish.
    setState({ phase: 'signed-out', waiting: true });
    stopPolling();
    const started = Date.now();
    poll.current = window.setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        stopPolling();
        setState({ phase: 'signed-out', waiting: false });
        return;
      }
      void refresh();
    }, POLL_MS);
  }, [bridge, refresh]);

  const signOut = useCallback(async () => {
    if (!bridge) return;
    stopPolling();
    const res = await bridge.signOut();
    if (res.ok) await refresh();
    else setState({ phase: 'signed-out', waiting: false, error: res.error });
  }, [bridge, refresh]);

  return { state, signIn, signOut, refresh };
}

export type ClaudeAccount = ReturnType<typeof useClaude>;
