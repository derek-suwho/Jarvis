import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('binds deterministic provenance to artifact bytes and explicit build identity', async () => {
  const modulePath = '../scripts/release-provenance.mjs';
  const { releaseProvenance } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.release-provenance-'));
  const identity = { version: '0.1.0', revision: 'a'.repeat(40), architecture: 'arm64',
    mode: 'unsigned', node: '26.13.0', npm: '11.20.0', electron: '44.10.0' };
  try {
    writeFileSync(join(root, 'Jarvis.zip '), 'artifact');
    const first = await releaseProvenance(root, identity);
    expect(first).toBe(await releaseProvenance(root, identity));
    expect(JSON.parse(first)).toEqual({ schemaVersion: 1, ...identity,
      artifacts: [{ path: 'Jarvis.zip ', sha256: createHash('sha256').update('artifact').digest('hex') }] });
    writeFileSync(join(root, 'Jarvis.zip '), 'changed');
    expect(await releaseProvenance(root, identity)).not.toBe(first);
    for (const invalid of [{ mode: 'release' }, { architecture: 'unknown' }, { revision: 'main' },
      { version: '' }, { npm: undefined }, { electron: 'latest' }]) {
      await expect(releaseProvenance(root, { ...identity, ...invalid })).rejects.toThrow(/identity/i);
    }
    rmSync(join(root, 'Jarvis.zip '));
    await expect(releaseProvenance(root, identity)).rejects.toThrow(/no artifacts/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
