import { useEffect, useRef, useState } from 'react';
import type { SubscriptionAccount } from '../lib/useSubscriptionAccount';

interface ConnectionProps {
  account: SubscriptionAccount;
  onInstall: () => void;
  installLabel?: string;
  signOutNotice?: string;
}

/** Shared controls for subscription providers whose sign-in is verified by the desktop bridge. */
export function SubscriptionConnection({ account, onInstall, installLabel = 'Install', signOutNotice }: ConnectionProps) {
  const { state } = account;
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (state.phase !== 'connected') setConfirmSignOut(false);
  }, [state.phase]);

  if (state.phase === 'unavailable') return <span className="connect-note">Open the Jarvis desktop app to connect</span>;
  if (state.phase === 'loading') return <span className="connect-note" role="status">Checking…</span>;
  if (state.phase === 'not-installed') return <button className="add-btn" onClick={onInstall}>{installLabel}</button>;
  if (state.phase === 'connected') {
    return (
      <div className="connect-actions">
        {confirmSignOut && signOutNotice && <span className="connect-note">{signOutNotice}</span>}
        <button
          className="text-btn danger account-action"
          title={signOutNotice}
          disabled={signingOut}
          onBlur={() => setConfirmSignOut(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && confirmSignOut) {
              event.preventDefault();
              event.stopPropagation();
              setConfirmSignOut(false);
              return;
            }
            if ((event.key === 'Enter' || event.key === ' ')
              && (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229)) {
              event.preventDefault();
            }
          }}
          onClick={async () => {
            if (signOutNotice && !confirmSignOut) {
              setConfirmSignOut(true);
              return;
            }
            setConfirmSignOut(false);
            setSigningOut(true);
            try { await account.signOut(); }
            finally { if (mounted.current) setSigningOut(false); }
          }}
        >
          {signingOut ? 'Signing out…' : confirmSignOut ? 'Confirm sign out' : 'Sign out'}
        </button>
      </div>
    );
  }
  if (state.signingIn) {
    return (
      <div className="connect-actions">
        <span className="connect-note" role="status">Finish signing in…</span>
        <button className="text-btn account-action" onClick={() => void account.cancel()}>Cancel</button>
      </div>
    );
  }
  return <button className="add-btn" onClick={() => void account.signIn()}>Sign in</button>;
}

export function SubscriptionStatusLine({ account }: { account: SubscriptionAccount }) {
  const { state } = account;
  const error = state.phase === 'connected' ? state.notice
    : state.phase === 'signed-out' || state.phase === 'not-installed' ? state.error : undefined;
  if (error) return <span className="connect-error status-text" role="alert" title={error}>{error}</span>;
  if (state.phase === 'connected') {
    const identity = state.email || state.name || 'Connected';
    const text = state.plan ? `${identity} · ${state.plan}` : identity;
    return <span className="status-dot connected" role="status"><span className="status-text" title={text}>{text}</span></span>;
  }
  if (state.phase === 'unavailable') return <span className="status-dot" role="status">Desktop app required</span>;
  if (state.phase === 'not-installed') return <span className="status-dot" role="status">Install to connect your account</span>;
  if (state.phase === 'signed-out' && state.signingIn) return <span className="status-dot" role="status">Waiting for sign-in</span>;
  if (state.phase === 'loading') return <span className="status-dot" role="status">Checking connection</span>;
  return <span className="status-dot" role="status">Not connected</span>;
}
