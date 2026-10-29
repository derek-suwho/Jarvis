import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubscriptionAuthBridge } from './desktop';

export type SubscriptionProvider = 'gemini' | 'grok';

export type SubscriptionAccountState =
  | { phase: 'unavailable' }
  | { phase: 'loading' }
  | { phase: 'not-installed'; error?: string }
  | { phase: 'signed-out'; signingIn: boolean; error?: string }
  | { phase: 'connected'; name: string | null; email: string | null; plan: string | null; notice?: string };

const POLL_MS = 2000;
const SIGN_IN_LIMIT_MS = 5 * 60 * 1000;
const PROVIDER_NAMES: Record<SubscriptionProvider, string> = { gemini: 'Gemini', grok: 'Grok' };

/** Account access is enabled only by the provider's verified status response. */
export function useSubscriptionAccount(provider: SubscriptionProvider) {
  const bridge: SubscriptionAuthBridge | undefined = typeof window !== 'undefined' ? window.jarvis?.[provider] : undefined;
  const name = PROVIDER_NAMES[provider];
  const [state, setState] = useState<SubscriptionAccountState>(bridge ? { phase: 'loading' } : { phase: 'unavailable' });
  const mounted = useRef(false);
  const operation = useRef(0);
  const request = useRef(0);
  const authOperation = useRef<'signin' | 'signout' | null>(null);
  const polling = useRef(false);
  const pollTimer = useRef<number | null>(null);
  const deadlineTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    polling.current = false;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    if (deadlineTimer.current !== null) window.clearTimeout(deadlineTimer.current);
    pollTimer.current = null;
    deadlineTimer.current = null;
  }, []);

  const current = useCallback((id: number) => mounted.current && operation.current === id, []);

  const checkStatus = useCallback(async (id: number) => {
    if (!bridge || !current(id) || authOperation.current === 'signout') return;
    const requestId = ++request.current;
    try {
      const status = await bridge.status();
      if (!current(id) || requestId !== request.current) return;
      if (!status.installed) {
        if (authOperation.current === 'signin') operation.current++;
        authOperation.current = null;
        stopPolling();
        setState({ phase: 'not-installed', error: status.error });
      } else if (status.connected) {
        operation.current++;
        authOperation.current = null;
        stopPolling();
        setState({ phase: 'connected', name: status.name, email: status.email, plan: status.plan });
      } else {
        setState({ phase: 'signed-out', signingIn: polling.current, error: status.error });
      }
    } catch {
      if (!current(id) || requestId !== request.current) return;
      setState({ phase: 'signed-out', signingIn: polling.current, error: `Could not check your ${name} connection. Try again.` });
    }
  }, [bridge, current, name, stopPolling]);

  const refresh = useCallback(async () => {
    await checkStatus(operation.current);
  }, [checkStatus]);

  const pollStatus = useCallback(async function pollStatus(id: number): Promise<void> {
    await checkStatus(id);
    if (current(id) && polling.current) {
      pollTimer.current = window.setTimeout(() => void pollStatus(id), POLL_MS);
    }
  }, [checkStatus, current]);

  useEffect(() => {
    mounted.current = true;
    const id = ++operation.current;
    setState(bridge ? { phase: 'loading' } : { phase: 'unavailable' });
    void checkStatus(id);
    window.addEventListener('focus', refresh);
    return () => {
      const wasSigningIn = polling.current;
      mounted.current = false;
      operation.current++;
      authOperation.current = null;
      stopPolling();
      window.removeEventListener('focus', refresh);
      if (wasSigningIn) void bridge?.cancel().catch(() => {});
    };
  }, [bridge, checkStatus, refresh, stopPolling]);

  const signIn = useCallback(async () => {
    if (!bridge || !mounted.current || polling.current || authOperation.current === 'signout') return;
    const id = ++operation.current;
    stopPolling();
    authOperation.current = 'signin';
    polling.current = true;
    setState({ phase: 'signed-out', signingIn: true });
    deadlineTimer.current = window.setTimeout(() => {
      if (!current(id)) return;
      operation.current++;
      authOperation.current = null;
      stopPolling();
      setState({ phase: 'signed-out', signingIn: false, error: 'Sign-in timed out. Try again.' });
      void bridge.cancel().catch(() => {});
    }, SIGN_IN_LIMIT_MS);
    try {
      const result = await bridge.signIn();
      if (!current(id)) return;
      if (!result.ok) {
        authOperation.current = null;
        stopPolling();
        setState({ phase: 'signed-out', signingIn: false, error: result.error || `Could not start ${name} sign-in. Try again.` });
        return;
      }
      // A browser launch or successful login command alone does not unlock plans.
      await pollStatus(id);
    } catch {
      if (!current(id)) return;
      authOperation.current = null;
      stopPolling();
      setState({ phase: 'signed-out', signingIn: false, error: `Could not start ${name} sign-in. Try again.` });
    }
  }, [bridge, current, name, pollStatus, stopPolling]);

  const cancel = useCallback(async () => {
    if (!bridge || !mounted.current) return;
    const id = ++operation.current;
    authOperation.current = null;
    stopPolling();
    setState({ phase: 'signed-out', signingIn: false });
    try {
      await bridge.cancel();
    } catch {
      if (current(id)) setState({ phase: 'signed-out', signingIn: false, error: 'Could not confirm sign-in was cancelled. Try again.' });
    }
  }, [bridge, current, stopPolling]);

  const signOut = useCallback(async (): Promise<boolean> => {
    if (!bridge || !mounted.current || authOperation.current === 'signout') return false;
    const id = ++operation.current;
    authOperation.current = 'signout';
    stopPolling();
    const failed = (message: string) => {
      if (current(id)) {
        authOperation.current = null;
        request.current++;
        setState((previous) => previous.phase === 'connected'
          ? { ...previous, notice: message }
          : { phase: 'signed-out', signingIn: false, error: message });
      }
      return false;
    };
    try {
      const result = await bridge.signOut();
      if (!current(id)) return false;
      if (!result.ok) return failed(result.error || `Could not sign out of ${name}. Try again.`);
      operation.current++;
      authOperation.current = null;
      setState({ phase: 'signed-out', signingIn: false });
      return true;
    } catch {
      return failed(`Could not confirm ${name} signed out. Try again.`);
    }
  }, [bridge, current, name, stopPolling]);

  return { state, signIn, cancel, signOut, refresh };
}

export type SubscriptionAccount = ReturnType<typeof useSubscriptionAccount>;
