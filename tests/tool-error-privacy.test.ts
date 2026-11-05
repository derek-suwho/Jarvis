import { expect, it } from 'vitest';
import host from '../electron/tools/host.cjs';

it('keeps arbitrary MCP connection diagnostics out of renderer status errors', () => {
  for (const diagnostic of [
    'Failed fetching https://user:password@example.test/mcp?token=private-token',
    'Authorization: Bearer private-token',
    'Server rejected API_KEY=private-token at /home/private/project',
    'Timed out connecting. private-token',
  ]) {
    expect(host.describeError(new Error(diagnostic))).toEqual({
      status: 'error', error: 'Could not connect. Check the server configuration and try again.',
    });
  }
  expect(host.describeError(new Error('HTTP 401 private-token'))).toEqual({
    status: 'needs-auth', error: 'Sign in to use this server.',
  });
  expect(host.describeError(Object.assign(new Error('private command'), { code: 'ENOENT' }))).toEqual({
    status: 'error', error: 'Command not found on this Mac.',
  });
  for (const diagnostic of ['Timed out connecting.', 'Timed out listing tools.']) {
    expect(host.describeError(new Error(diagnostic))).toEqual({ status: 'error', error: diagnostic });
  }
});
