// OAuth for remote MCP servers (most hosted servers, e.g. GitHub, Vercel, Figma, need it).
// Tokens are stored with the server's other secrets; sign-in runs in the system browser.
const crypto = require('node:crypto');
const http = require('node:http');
const { auth } = require('@modelcontextprotocol/sdk/client/auth.js');

const CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/mcp/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;

/**
 * SDK OAuthClientProvider backed by the store. Outside an explicit sign-in it never opens a browser:
 * a server needing authorization just reports that it needs sign-in.
 */
function createProvider(store, serverId) {
  const saved = () => store.secrets(serverId).oauth ?? {};
  const save = (patch) => store.saveSecrets(serverId, { oauth: { ...saved(), ...patch } });
  const provider = {
    expectedState: null,
    onRedirect: null,
    get redirectUrl() {
      return REDIRECT_URL;
    },
    get clientMetadata() {
      return {
        client_name: 'Jarvis',
        redirect_uris: [REDIRECT_URL],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },
    state() {
      provider.expectedState = crypto.randomBytes(24).toString('base64url');
      return provider.expectedState;
    },
    clientInformation: () => saved().client,
    saveClientInformation: (client) => save({ client }),
    tokens: () => saved().tokens,
    saveTokens: (tokens) => save({ tokens }),
    saveCodeVerifier: (verifier) => save({ verifier }),
    codeVerifier: () => saved().verifier,
    redirectToAuthorization(url) {
      provider.onRedirect?.(url);
    },
    invalidateCredentials(scope) {
      if (scope === 'all') store.saveSecrets(serverId, { oauth: {} });
      else if (scope === 'client') save({ client: undefined });
      else if (scope === 'tokens') save({ tokens: undefined });
      else if (scope === 'verifier') save({ verifier: undefined });
    },
  };
  return provider;
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

/** Waits for the browser to come back to the loopback callback with a code matching `provider.expectedState`. */
function listenForCode(provider) {
  const server = http.createServer();
  let settle;
  const code = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out.')), SIGN_IN_TIMEOUT_MS);
    settle = (err, value) => {
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(value);
    };
  });
  server.on('request', (req, res) => {
    const url = new URL(req.url, REDIRECT_URL);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const q = url.searchParams;
    if (!provider.expectedState || q.get('state') !== provider.expectedState) {
      resultPage(res, false, 'This sign-in response did not match the request. Try again from Jarvis.');
      return settle(new Error('Sign-in response did not match this request.'));
    }
    if (q.get('error') || !q.get('code')) {
      resultPage(res, false, q.get('error_description') || q.get('error') || 'No authorization code was returned.');
      return settle(new Error(q.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in failed.'));
    }
    resultPage(res, true, 'You can close this tab and return to Jarvis.');
    settle(null, q.get('code'));
  });
  const ready = new Promise((resolve, reject) => {
    server.once('error', (err) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${CALLBACK_PORT} is busy; close the other sign-in and retry.`) : err),
    );
    server.listen(CALLBACK_PORT, '127.0.0.1', resolve);
  });
  return { ready, code, cancel: () => settle(new Error('Sign-in was cancelled.')) };
}

/** Full browser sign-in for one server. Resolves once tokens are saved. */
async function signIn(provider, serverUrl, openExternal) {
  const callback = listenForCode(provider);
  callback.code.catch(() => {});
  await callback.ready;
  provider.onRedirect = (url) => openExternal(url.toString());
  try {
    if ((await auth(provider, { serverUrl })) === 'AUTHORIZED') return callback.cancel();
    const code = await callback.code;
    await auth(provider, { serverUrl, authorizationCode: code });
  } catch (err) {
    callback.cancel();
    throw err;
  } finally {
    provider.onRedirect = null;
  }
}

/** Fresh Authorization header for a server, refreshing the token if needed; null when not signed in. */
async function bearerHeader(provider, serverUrl) {
  if (!provider.tokens()) return null;
  try {
    if ((await auth(provider, { serverUrl })) !== 'AUTHORIZED') return null;
  } catch {
    return null;
  }
  const tokens = provider.tokens();
  return tokens?.access_token ? `Bearer ${tokens.access_token}` : null;
}

module.exports = { createProvider, signIn, bearerHeader, REDIRECT_URL };
