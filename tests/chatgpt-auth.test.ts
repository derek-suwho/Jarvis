import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const authFile = new URL('../electron/chatgpt-auth.cjs', import.meta.url);
const source = readFileSync(authFile, 'utf8');
const require = createRequire(authFile);

function status(record: object | null) {
  const module = { exports: {} as { status: () => Record<string, unknown> } };
  runInNewContext(source, {
    module,
    require: (id: string) => {
      if (id === 'electron') return { app: { getPath: () => '/fixture' }, shell: {} };
      if (id === 'node:fs') return { readFileSync: () => JSON.stringify(record) };
      return require(id);
    },
  });
  return module.exports.status();
}

const token = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const connected = {
  client_id: 'oaiapp_fixture',
  refresh_token: 'fixture-refresh-secret',
  access_token: 'fixture-access-secret',
  saved_at: new Date().toISOString(),
  email: 'alex@example.com',
};

describe('ChatGPT public profile status', () => {
  it('recovers a display name from an existing session without exposing tokens', () => {
    expect(status({ ...connected, id_token: token({ name: 'Alex Example' }) })).toEqual({
      connected: true,
      registered: true,
      name: 'Alex Example',
      email: 'alex@example.com',
    });
  });

  it('prefers persisted profile metadata and tolerates legacy or malformed tokens', () => {
    expect(status({ ...connected, name: 'Saved Name', id_token: token({ name: 'Old Name' }) }).name).toBe('Saved Name');
    expect(status({ ...connected, id_token: 'malformed' }).name).toBeNull();
    expect(status({ ...connected, id_token: token({ given_name: 'Alex', family_name: 'Example' }) }).name).toBe('Alex Example');
  });

  it('does not turn profile metadata into an authenticated session', () => {
    expect(status({ name: 'Alex Example', email: 'alex@example.com' }).connected).toBe(false);
    expect(status(null)).toEqual({ connected: false, registered: false, name: null, email: null });
  });
});
