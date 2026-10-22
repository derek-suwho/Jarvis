import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import oauth from '../electron/chatgpt-oauth.cjs';

const params = (url: string) => new URL(url).searchParams;

describe('buildAuthorizeUrl', () => {
  const base = {
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    hostId: 'urn:uuid:11111111-2222-4333-8444-555555555555',
    state: 's',
    nonce: 'n',
    codeChallenge: 'c',
  };

  it('uses dynamic registration with the app name on first sign-in', () => {
    const q = params(oauth.buildAuthorizeUrl({ ...base, registration: null }));
    expect(q.get('client_id')).toBe('dynamic_agent_client');
    expect(q.get('agent_name_hint')).toBe('Jarvis');
    expect(q.get('scope')).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
    expect(q.get('resource')).toBe('https://api.openai.com/v1');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('ext_agent_host_id')).toBe(base.hostId);
  });

  it('reuses the issued client and hints for a returning account', () => {
    const q = params(
      oauth.buildAuthorizeUrl({ ...base, registration: { clientId: 'oaiapp_x', idToken: 't', email: 'a@b.co' } }),
    );
    expect(q.get('client_id')).toBe('oaiapp_x');
    expect(q.get('agent_name_hint')).toBeNull();
    expect(q.get('id_token_hint')).toBe('t');
    expect(q.get('login_hint')).toBe('a@b.co');
  });
});

describe('pkceChallenge', () => {
  // Expected value computed independently: printf %s VERIFIER | openssl dgst -sha256 -binary | base64url (no padding).
  it('is the unpadded base64url SHA-256 of the verifier', () => {
    expect(oauth.pkceChallenge('dBjftJeZ4CVP-mJ92K1oUOOjfgcsr3MDHcMSDnw4eNE')).toBe(
      'ncFuMcSisf1dChS_nIhJcNS_DB-iPJLxMziycB4IBac',
    );
  });
});

describe('parseCallback', () => {
  it('rejects a state mismatch before anything else', () => {
    expect(oauth.parseCallback('/auth/callback?code=x&state=evil', 'good', null).error).toMatch(/did not match/);
  });

  it('reports cancellation', () => {
    expect(oauth.parseCallback('/auth/callback?error=access_denied&state=s', 's', null).error).toBe(
      'Sign-in was cancelled.',
    );
  });

  it('requires an issued oaiapp_ client id on first registration', () => {
    expect(oauth.parseCallback('/auth/callback?code=x&state=s', 's', null).error).toMatch(/Registration incomplete/);
    expect(oauth.parseCallback('/auth/callback?code=x&state=s&client_id=oaiapp_1', 's', null)).toEqual({
      code: 'x',
      clientId: 'oaiapp_1',
    });
  });

  it('keeps the saved client id for a returning account', () => {
    expect(oauth.parseCallback('/auth/callback?code=x&state=s', 's', { clientId: 'oaiapp_saved' })).toEqual({
      code: 'x',
      clientId: 'oaiapp_saved',
    });
  });
});

describe('ID token validation', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }] };
  const sign = (payload: object, kid = 'k1') => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'RS256', kid })}.${enc(payload)}`;
    return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const now = Date.now();
  const good = { iss: 'https://auth.openai.com', aud: 'oaiapp_1', exp: now / 1000 + 600, nonce: 'n', sub: 'user-1' };

  it('accepts a correctly signed token and rejects tampering or unknown keys', () => {
    const token = sign(good);
    expect(oauth.verifyJwtSignature(token, jwks)).toBe(true);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...good, sub: 'attacker' })).toString('base64url')}.${s}`;
    expect(oauth.verifyJwtSignature(forged, jwks)).toBe(false);
    expect(oauth.verifyJwtSignature(sign(good, 'other'), jwks)).toBe(false);
  });

  it('checks issuer, audience, expiry and nonce', () => {
    const ctx = { clientId: 'oaiapp_1', nonce: 'n', now };
    expect(oauth.checkIdTokenClaims(good, ctx)).toBeNull();
    expect(oauth.checkIdTokenClaims({ ...good, iss: 'https://evil.example' }, ctx)).toMatch(/issuer/);
    expect(oauth.checkIdTokenClaims({ ...good, aud: ['oaiapp_2'] }, ctx)).toMatch(/different client/);
    expect(oauth.checkIdTokenClaims({ ...good, exp: now / 1000 - 1 }, ctx)).toMatch(/expired/);
    expect(oauth.checkIdTokenClaims({ ...good, nonce: 'x' }, ctx)).toMatch(/nonce/);
  });
});

describe('token lifetimes', () => {
  const savedAt = '2026-10-21T12:00:00.000Z';
  const t0 = Date.parse(savedAt);
  const record = { saved_at: savedAt, expires_in: 3600 };

  it('refreshes five minutes before the access token expires', () => {
    expect(oauth.needsRefresh(record, t0 + 50 * 60_000)).toBe(false);
    expect(oauth.needsRefresh(record, t0 + 56 * 60_000)).toBe(true);
  });

  it('treats a refresh token older than 30 days as expired', () => {
    expect(oauth.refreshExpired(record, t0 + 29 * 86_400_000)).toBe(false);
    expect(oauth.refreshExpired(record, t0 + 31 * 86_400_000)).toBe(true);
  });

  it('reads granted scopes from either response shape', () => {
    expect(oauth.grantedScopes({ scope: 'openid chatgpt.tokens.use.direct' })).toContain('chatgpt.tokens.use.direct');
    expect(oauth.grantedScopes({ scopes: ['a'] })).toEqual(['a']);
  });
});
