import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

it('requires signature, Gatekeeper and staple verification and stops at any failed check', async () => {
  const modulePath = '../scripts/verify-macos-artifact.mjs';
  const { verifyMacosArtifact } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.macos-verification-'));
  const app = join(root, 'Jarvis candidate.app');
  const dmg = join(root, 'Jarvis candidate.dmg');
  mkdirSync(app);
  writeFileSync(dmg, 'fixture disk image');
  try {
    const commands = [
      ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]],
      ['codesign', ['--display', '--verbose=4', app]],
      ['spctl', ['--assess', '--type', 'execute', '--verbose=4', app]],
      ['xcrun', ['stapler', 'validate', app]],
      ['xcrun', ['stapler', 'validate', dmg]],
      ['spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]],
    ];
    const run = vi.fn(() => ({ status: 0, stderr: 'CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+0' }));
    expect(await verifyMacosArtifact(app, dmg, { platform: 'darwin', run })).toEqual({ app, dmg, verified: true });
    expect(run.mock.calls.map((call: any[]) => call.slice(0, 2))).toEqual(commands);
    for (let failure = 0; failure < commands.length; failure++) {
      let index = 0;
      const rejected = vi.fn(() => ({ status: index++ === failure ? 1 : 0, stderr: 'CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+0' }));
      await expect(verifyMacosArtifact(app, dmg, { platform: 'darwin', run: rejected })).rejects.toThrow(/verification failed/i);
      expect(rejected).toHaveBeenCalledTimes(failure + 1);
    }
    const unavailable = vi.fn(() => ({ status: null, error: new Error('missing tool') }));
    await expect(verifyMacosArtifact(app, dmg, { platform: 'darwin', run: unavailable })).rejects.toThrow(/verification failed/i);
    const unused = vi.fn();
    await expect(verifyMacosArtifact(app, dmg, { platform: 'linux', run: unused })).rejects.toThrow(/macOS/);
    await expect(verifyMacosArtifact(app, join(root, 'missing.dmg'), { platform: 'darwin', run: unused })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


it('rejects a signed app without hardened runtime before Gatekeeper or staple checks', async () => {
  const modulePath = '../scripts/verify-macos-artifact.mjs';
  const { verifyMacosArtifact } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.macos-verification-'));
  const app = join(root, 'Jarvis.app');
  const dmg = join(root, 'Jarvis.dmg');
  mkdirSync(app);
  writeFileSync(dmg, 'fixture');
  try {
    for (const stderr of ['CodeDirectory v=20500 size=123 flags=0x0(none) hashes=1+0', '', 'runtime flags=0x10000(runtime)']) {
      const run = vi.fn(() => ({ status: 0, stderr }));
      await expect(verifyMacosArtifact(app, dmg, { platform: 'darwin', run })).rejects.toThrow(/hardened runtime/i);
      expect(run.mock.calls.map((call: any[]) => call[0])).toEqual(['codesign', 'codesign']);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
