// Pure helpers for "Sign in with ChatGPT" (OpenAI's token-sharing flow for open-source, locally hosted apps).
// Spec: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const crypto = require('node:crypto');

const AUTH_BASE = 'https://auth.openai.com';
const AUTHORIZE_URL = `${AUTH_BASE}/api/accounts/authorize`;
const TOKEN_URL = `${AUTH_BASE}/api/accounts/oauth/token`;
const DISCOVERY_URL = `${AUTH_BASE}/.well-known/openid-configuration`;
const ISSUER = AUTH_BASE;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const APP_NAME = 'Jarvis';
const CALLBACK_PATH = '/auth/callback';
const PREFERRED_PORT = 1455;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const base64url = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = (bytes = 32) => base64url(crypto.randomBytes(bytes));
const pkceChallenge = (verifier) => base64url(crypto.createHash('sha256').update(verifier).digest());
const newHostId = () => `urn:uuid:${crypto.randomUUID()}`;

/**
 * `registration` is the saved { clientId, idToken?, email? } of a returning account,
 * or null for a first sign-in (dynamic client registration).
 */
function buildAuthorizeUrl({ redirectUri, hostId, state, nonce, codeChallenge, registration }) {
  const p = new URLSearchParams();
  if (registration) {
    p.set('client_id', registration.clientId);
    if (registration.idToken) p.set('id_token_hint', registration.idToken);
    if (registration.email) p.set('login_hint', registration.email);
  } else {
    p.set('client_id', DYNAMIC_CLIENT_ID);
    p.set('agent_name_hint', APP_NAME);
  }
  p.set('ext_agent_host_id', hostId);
  p.set('response_type', 'code');
  p.set('redirect_uri', redirectUri);
  p.set('scope', SCOPES.join(' '));
  p.set('resource', RESOURCE);
  p.set('state', state);
  p.set('nonce', nonce);
  p.set('code_challenge_method', 'S256');
  p.set('code_challenge', codeChallenge);
  return `${AUTHORIZE_URL}?${p}`;
}

/** Validates the loopback callback. Returns { code, clientId } or { error }. */
function parseCallback(requestUrl, expectedState, registration) {
  const q = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  if (q.get('state') !== expectedState) return { error: 'Sign-in response did not match this request. Please try again.' };
  const err = q.get('error');
  if (err) {
    return { error: err === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${q.get('error_description') || err}` };
  }
  const code = q.get('code');
  if (!code) return { error: 'Sign-in failed: no authorization code was returned.' };
  const clientId = registration ? registration.clientId : q.get('client_id');
  if (!clientId || (!registration && !clientId.startsWith('oaiapp_'))) {
    return { error: 'Registration incomplete: ChatGPT did not issue a client ID. Please try again.' };
  }
  return { code, clientId };
}

function decodeJwt(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Error('Malformed ID token.');
  const json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  return {
    header: json(parts[0]),
    payload: json(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

/** Display-only profile metadata; never used to decide whether an account is authenticated. */
function profileName(claims) {
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const full = text(claims?.name);
  const parts = [text(claims?.given_name), text(claims?.family_name)].filter(Boolean).join(' ');
  return (full || parts).slice(0, 120) || null;
}

/** Verifies an RS256/ES256 JWT signature against a JWKS document. */
function verifyJwtSignature(token, jwks) {
  const { header, signingInput, signature } = decodeJwt(token);
  const jwk = (jwks?.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(signingInput);
  if (header.alg === 'RS256') return crypto.verify('sha256', data, key, signature);
  if (header.alg === 'ES256') return crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  return false;
}

/** Returns an error message, or null when issuer, audience, expiry, nonce and subject all check out. */
function checkIdTokenClaims(payload, { clientId, nonce, now = Date.now() }) {
  if (payload.iss !== ISSUER) return 'ID token issuer is not OpenAI.';
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) return 'ID token was issued for a different client.';
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return 'ID token has expired.';
  if (payload.nonce !== nonce) return 'ID token nonce does not match this sign-in.';
  if (!payload.sub) return 'ID token has no account identity.';
  return null;
}

function grantedScopes(tokenResponse) {
  if (Array.isArray(tokenResponse.scopes)) return tokenResponse.scopes;
  return typeof tokenResponse.scope === 'string' ? tokenResponse.scope.split(/[\s+]+/).filter(Boolean) : [];
}

const accessExpiresAt = (record) => Date.parse(record.saved_at) + record.expires_in * 1000;
const needsRefresh = (record, now = Date.now()) => accessExpiresAt(record) - REFRESH_MARGIN_MS <= now;
const refreshExpired = (record, now = Date.now()) => Date.parse(record.refresh_saved_at || record.saved_at) + REFRESH_TOKEN_LIFETIME_MS <= now;

module.exports = {
  AUTHORIZE_URL,
  TOKEN_URL,
  DISCOVERY_URL,
  ISSUER,
  RESOURCE,
  SCOPES,
  PLAN_SCOPE,
  DYNAMIC_CLIENT_ID,
  CALLBACK_PATH,
  PREFERRED_PORT,
  randomToken,
  pkceChallenge,
  newHostId,
  buildAuthorizeUrl,
  parseCallback,
  decodeJwt,
  profileName,
  verifyJwtSignature,
  checkIdTokenClaims,
  grantedScopes,
  accessExpiresAt,
  needsRefresh,
  refreshExpired,
};
