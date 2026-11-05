import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run only against the final artifacts. This does not sign, notarize or publish.
export async function verifyMacosArtifact(app, dmg, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'darwin') throw new Error('Artifact verification requires macOS');
  if (typeof app !== 'string' || !app.endsWith('.app') || typeof dmg !== 'string' || !dmg.endsWith('.dmg')) {
    throw new Error('Expected an .app directory and a .dmg file');
  }
  app = resolve(app);
  dmg = resolve(dmg);
  const appStat = await lstat(app);
  const dmgStat = await lstat(dmg);
  if (!appStat.isDirectory() || !dmgStat.isFile() || dmgStat.size === 0) {
    throw new Error('Expected an app directory and a nonempty disk image; symbolic links are not allowed');
  }
  const checks = [
    ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]],
    ['codesign', ['--display', '--verbose=4', app]],
    ['spctl', ['--assess', '--type', 'execute', '--verbose=4', app]],
    ['xcrun', ['stapler', 'validate', app]],
    ['xcrun', ['stapler', 'validate', dmg]],
    ['spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]],
  ];
  for (const [command, args] of checks) {
    let result;
    try {
      result = run(command, args, { encoding: 'utf8', timeout: 120_000, shell: false });
    } catch {
      throw new Error(`Artifact verification failed: ${command} ${args[0]}`);
    }
    if (result?.status !== 0 || result.error || result.signal) {
      throw new Error(`Artifact verification failed: ${command} ${args[0]}`);
    }
    if (command === 'codesign' && args[0] === '--display') {
      // codesign writes display metadata to stderr. Check the numeric flag rather
      // than accepting an unrelated occurrence of the word runtime.
      const flags = /^CodeDirectory\b[^\r\n]*\bflags=0x([0-9a-f]+)\(/im.exec(result.stderr ?? '');
      if (!flags || (BigInt(`0x${flags[1]}`) & 0x10000n) === 0n) {
        throw new Error('Artifact verification requires hardened runtime');
      }
    }
  }
  return { app, dmg, verified: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/verify-macos-artifact.mjs <app> <dmg>');
    console.log(JSON.stringify(await verifyMacosArtifact(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
