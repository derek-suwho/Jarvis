import { useCallback, useEffect, useState } from 'react';
import type { ChatGPTStatus } from './desktop';

export type ChatGPTState =
  | { phase: 'unavailable' }
  | { phase: 'loading' }
  | { phase: 'signing-in' }
  | { phase: 'signed-out'; registered: boolean; error?: string }
  | { phase: 'connected'; name?: string | null; email: string | null; notice?: string };

const WELCOME_KEY = 'jarvis.chatgptWelcomeSeen';

function fromStatus(s: ChatGPTStatus): ChatGPTState {
  return s.connected ? { phase: 'connected', name: s.name ?? null, email: s.email } : { phase: 'signed-out', registered: s.registered };
}

function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** ChatGPT account connection via the desktop bridge. In a plain browser the account is unavailable. */
export function useChatGPT() {
  const bridge = typeof window !== 'undefined' ? window.jarvis?.chatgpt : undefined;
  const [state, setState] = useState<ChatGPTState>(bridge ? { phase: 'loading' } : { phase: 'unavailable' });
  const [showWelcome, setShowWelcome] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const s = await bridge.status();
      setState((prev) => (prev.phase === 'signing-in' ? prev : fromStatus(s)));
    } catch {
      setState({ phase: 'signed-out', registered: false, error: 'Could not read your ChatGPT connection.' });
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (!bridge) return;
    setState({ phase: 'signing-in' });
    const result = await bridge.signIn();
    if (result.ok) {
      setState(fromStatus(result.status));
      // OpenAI's guidelines: show the plan-usage welcome on the first sign-in only.
      if (!welcomeSeen()) setShowWelcome(true);
    } else {
      const s = await bridge.status().catch(() => null);
      setState({ phase: 'signed-out', registered: !!s?.registered, error: result.error });
    }
  }, [bridge]);

  const cancel = useCallback(() => void bridge?.cancel(), [bridge]);

  const signOut = useCallback(async () => {
    if (!bridge) return;
    const { revoked } = await bridge.signOut();
    const s = await bridge.status();
    setState(
      revoked
        ? fromStatus(s)
        : {
            phase: 'signed-out',
            registered: s.registered,
            error: 'Signed out on this device, but OpenAI did not confirm the session was revoked.',
          },
    );
  }, [bridge]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // Non-critical: the welcome may show again next sign-in.
    }
  }, []);

  return { state, signIn, cancel, signOut, showWelcome, dismissWelcome };
}

export type ChatGPTAccount = ReturnType<typeof useChatGPT>;
