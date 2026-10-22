// ChatGPT account connection: runs only in the Electron main process so tokens never reach the renderer.
const { app, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const oauth = require('./chatgpt-oauth.cjs');

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const dir = () => path.join(app.getPath('userData'), 'chatgpt');
const hostFile = () => path.join(dir(), 'host.json');
const credFile = () => path.join(dir(), 'credentials.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic write with owner-only permissions, as the spec requires for credential files. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/** Stable, opaque per-host identifier, created once before the first sign-in. */
function hostId() {
  const saved = readJson(hostFile());
  if (saved?.ext_agent_host_id) return saved.ext_agent_host_id;
  const id = oauth.newHostId();
  writeJson(hostFile(), { ext_agent_host_id: id });
  return id;
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. empty revocation success).
  }
  return { ok: res.ok, status: res.status, json };
}

let discoveryCache = null;
async function discovery() {
  if (!discoveryCache) {
    const res = await fetch(oauth.DISCOVERY_URL);
    if (!res.ok) throw new Error(`Could not reach OpenAI sign-in (${res.status}).`);
    discoveryCache = await res.json();
  }
  return discoveryCache;
}

async function validateIdToken(idToken, { clientId, nonce }) {
  const { jwks_uri: jwksUri } = await discovery();
  const jwks = await (await fetch(jwksUri)).json();
  if (!oauth.verifyJwtSignature(idToken, jwks)) throw new Error('Could not verify the ChatGPT ID token signature.');
  const { payload } = oauth.decodeJwt(idToken);
  const problem = oauth.checkIdTokenClaims(payload, { clientId, nonce });
  if (problem) throw new Error(problem);
  return payload;
}

function publicStatus(record) {
  const connected = !!record?.refresh_token && !oauth.refreshExpired(record);
  return {
    connected,
    email: record?.email ?? null,
    // A saved registration means "Continue with ChatGPT" reuses the same client.
    registered: !!record?.client_id,
  };
}

function status() {
  return publicStatus(readJson(credFile()));
}

function listen() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const tryPort = (port) => {
      server.once('error', (err) => {
        // The spec allows any loopback port; fall back to an OS-assigned one if 1455 is taken.
        if (err.code === 'EADDRINUSE' && port !== 0) tryPort(0);
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    };
    tryPort(oauth.PREFERRED_PORT);
  });
}

function resultPage(res, ok, message) {
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const title = ok ? 'Connected to Jarvis' : 'Sign-in did not finish';
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:-apple-system,sans-serif;background:#212121;color:#ececec;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:420px;text-align:center"><h2 style="font-weight:600">${title}</h2>
<p style="color:#b4b4b4">${escape(message)}</p></div>`);
}

let cancelPending = null;

async function signIn() {
  cancelPending?.();
  const existing = readJson(credFile());
  const registration = existing?.client_id
    ? { clientId: existing.client_id, idToken: existing.id_token, email: existing.email }
    : null;
  const host = hostId();
  const state = oauth.randomToken();
  const nonce = oauth.randomToken();
  const verifier = oauth.randomToken(48);
  const { server, port } = await listen();
  const redirectUri = `http://127.0.0.1:${port}${oauth.CALLBACK_PATH}`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      cancelPending = null;
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out. Please try again.' }), SIGN_IN_TIMEOUT_MS);
    cancelPending = () => finish({ ok: false, error: 'Sign-in cancelled.' });

    server.on('request', async (req, res) => {
      if (!req.url?.startsWith(oauth.CALLBACK_PATH)) {
        res.writeHead(404).end();
        return;
      }
      const cb = oauth.parseCallback(req.url, state, registration);
      if (cb.error) {
        resultPage(res, false, cb.error);
        finish({ ok: false, error: cb.error });
        return;
      }
      try {
        const record = await exchangeCode({ ...cb, verifier, redirectUri, nonce, host });
        resultPage(res, true, 'You can close this tab and return to Jarvis.');
        finish({ ok: true, status: publicStatus(record) });
      } catch (err) {
        resultPage(res, false, err.message);
        finish({ ok: false, error: err.message });
      }
    });

    const url = oauth.buildAuthorizeUrl({
      redirectUri,
      hostId: host,
      state,
      nonce,
      codeChallenge: oauth.pkceChallenge(verifier),
      registration,
    });
    shell.openExternal(url).catch(() => finish({ ok: false, error: 'Could not open your browser.' }));
  });
}

async function exchangeCode({ code, clientId, verifier, redirectUri, nonce, host }) {
  const res = await postForm(oauth.TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: oauth.RESOURCE,
  });
  if (!res.ok) {
    if (res.json?.error === 'invalid_grant') throw new Error('The sign-in code expired. Please try again.');
    throw new Error(`ChatGPT sign-in failed (HTTP ${res.status}).`);
  }
  const tokens = res.json;
  const claims = await validateIdToken(tokens.id_token, { clientId, nonce });
  const scopes = oauth.grantedScopes(tokens);
  if (!scopes.includes(oauth.PLAN_SCOPE)) {
    throw new Error('ChatGPT did not grant plan access for this app, so Jarvis cannot use your plan.');
  }
  const now = new Date().toISOString();
  const record = {
    email: claims.email ?? null,
    issuer: oauth.ISSUER,
    subject: claims.sub,
    client_id: clientId,
    ext_agent_host_id: host,
    id_token: tokens.id_token,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? 'Bearer',
    expires_in: tokens.expires_in ?? 3600,
    scopes,
    saved_at: now,
    refresh_saved_at: now,
  };
  writeJson(credFile(), record);
  return record;
}

/** Keeps the registration (client ID, email) for re-sign-in but drops every token. */
function clearTokens(record) {
  const { client_id, email, subject, ext_agent_host_id } = record;
  writeJson(credFile(), { client_id, email, subject, ext_agent_host_id });
}

let refreshing = null;

/** Refreshes are serialized so two callers never race a rotating refresh token. */
function refresh() {
  refreshing ??= (async () => {
    const record = readJson(credFile());
    if (!record?.refresh_token) throw new Error('Not signed in to ChatGPT.');
    const res = await postForm(oauth.TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: record.client_id,
      refresh_token: record.refresh_token,
      resource: oauth.RESOURCE,
    });
    if (!res.ok) {
      if (res.json?.error === 'invalid_grant') clearTokens(record);
      throw new Error('Your ChatGPT session expired. Continue with ChatGPT to sign in again.');
    }
    const t = res.json;
    const now = new Date().toISOString();
    const next = {
      ...record,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? record.refresh_token,
      id_token: t.id_token ?? record.id_token,
      expires_in: t.expires_in ?? 3600,
      scopes: t.scope || t.scopes ? oauth.grantedScopes(t) : record.scopes,
      saved_at: now,
      refresh_saved_at: t.refresh_token ? now : record.refresh_saved_at,
    };
    writeJson(credFile(), next);
    return next;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Access token for ChatGPT-plan inference, refreshed when close to expiry. Main process only. */
async function getAccessToken({ forceRefresh = false } = {}) {
  let record = readJson(credFile());
  if (!record?.access_token) throw new Error('Not signed in to ChatGPT. Continue with ChatGPT in Settings.');
  if (forceRefresh || oauth.needsRefresh(record)) record = await refresh();
  return record.access_token;
}

async function signOut() {
  const record = readJson(credFile());
  if (!record?.refresh_token) return { ok: true, revoked: true };
  let revoked = false;
  try {
    const { revocation_endpoint: endpoint } = await discovery();
    for (let attempt = 0; attempt < 3 && !revoked; attempt++) {
      try {
        const res = await postForm(endpoint, {
          token: record.refresh_token,
          token_type_hint: 'refresh_token',
          client_id: record.client_id,
        });
        if (res.ok) revoked = true;
        else if (res.status < 500) break;
      } catch {
        // Network error: retry with backoff below.
      }
      if (!revoked) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  } catch {
    // Discovery failed; tokens are still cleared locally.
  }
  clearTokens(record);
  return { ok: true, revoked };
}

function registerIpc(ipcMain) {
  ipcMain.handle('chatgpt:status', () => status());
  ipcMain.handle('chatgpt:sign-in', () => signIn());
  ipcMain.handle('chatgpt:cancel', () => cancelPending?.());
  ipcMain.handle('chatgpt:sign-out', () => signOut());
}

module.exports = { registerIpc, getAccessToken, status };
