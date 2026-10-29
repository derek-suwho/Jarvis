import React from 'react';
import { createRoot } from 'react-dom/client';
import { useSubscriptionAccount } from '../../src/lib/useSubscriptionAccount';
import { SubscriptionConnection, SubscriptionStatusLine } from '../../src/components/SubscriptionAccount';

// Exercise real React lifecycle and hook timers with isolated, explicitly fake bridges.
const originalSetTimeout = window.setTimeout.bind(window);
window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 2000 ? 20 : delay === 300000 ? 1000 : delay, ...args);
const calls = { status: 0, signIn: 0, cancel: 0, signOut: 0, install: 0 };
let status = { installed: true, connected: false, name: null, email: null, plan: null };
let signInResult = { ok: true };
let signOutResult = { ok: true };
let pendingSignIn;
let pendingStatus;
let pendingSignOut;
let deferSignIn = false;
let deferStatus = false;
let rejectSignOut = false;
let deferSignOut = false;
const bridge = {
  async status() {
    calls.status++;
    if (deferStatus) return new Promise((resolve) => { pendingStatus = resolve; });
    return { ...status };
  },
  async signIn() {
    calls.signIn++;
    if (deferSignIn) return new Promise((resolve) => { pendingSignIn = resolve; });
    return signInResult;
  },
  async cancel() { calls.cancel++; },
  async signOut() {
    calls.signOut++;
    if (deferSignOut) return new Promise((resolve) => { pendingSignOut = resolve; });
    if (rejectSignOut) throw new Error('Fixture transport rejection');
    return signOutResult;
  },
};
window.jarvis = { gemini: bridge, grok: bridge };
let account;
let root = createRoot(document.querySelector('#root'));
function Fixture() {
  account = useSubscriptionAccount('gemini');
  return <>
    <SubscriptionStatusLine account={account} />
    <SubscriptionConnection account={account} onInstall={() => calls.install++} installLabel="Install Gemini" />
  </>;
}
window.subscriptionFixture = {
  state: () => account.state,
  calls,
  setStatus: (next) => { status = { ...status, ...next }; },
  setSignInResult: (next) => { signInResult = next; },
  setSignOutResult: (next) => { signOutResult = next; },
  rejectSignOut: (value) => { rejectSignOut = value; },
  deferSignIn: (value) => { deferSignIn = value; },
  deferStatus: (value) => { deferStatus = value; },
  deferSignOut: (value) => { deferSignOut = value; },
  resolveSignIn: (value) => pendingSignIn?.(value),
  resolveStatus: (value) => pendingStatus?.(value),
  resolveSignOut: (value) => pendingSignOut?.(value),
  signIn: () => account.signIn(),
  cancel: () => account.cancel(),
  signOut: () => account.signOut(),
  refresh: () => account.refresh(),
  unmount: () => root.unmount(),
  remount: () => { root = createRoot(document.querySelector('#root')); root.render(<Fixture />); },
};
root.render(<Fixture />);
