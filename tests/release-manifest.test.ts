import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('rejects an empty artifact directory, a file root, and a missing directory', async () => {
  const modulePath = '../scripts/release-manifest.mjs';
  const { releaseManifest } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.release-manifest-'));
  try {
    mkdirSync(join(root, 'empty'));
    await expect(releaseManifest(root)).rejects.toThrow(/no artifacts/i);
    writeFileSync(join(root, 'artifact.zip'), 'release');
    await expect(releaseManifest(join(root, 'artifact.zip'))).rejects.toThrow(/directory/i);
    await expect(releaseManifest(join(root, 'missing'))).rejects.toThrow(/ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('produces stable sorted checksums for artifact bytes and rejects symbolic links', async () => {
  const modulePath = '../scripts/release-manifest.mjs';
  const { releaseManifest } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.release-manifest-'));
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'z.zip'), 'release');
    writeFileSync(join(root, 'nested', 'a.dmg'), 'disk');
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const expected = `${hash('disk')}  nested/a.dmg\n${hash('release')}  z.zip\n`;
    expect(await releaseManifest(root)).toBe(expected);
    writeFileSync(join(root, 'z.zip'), 'release');
    expect(await releaseManifest(root)).toBe(expected);
    writeFileSync(join(root, 'z.zip'), 'changed');
    expect(await releaseManifest(root)).not.toBe(expected);
    symlinkSync(join(root, 'z.zip'), join(root, 'alias.zip'));
    await expect(releaseManifest(root)).rejects.toThrow(/symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
