import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('proves durable chat deletion across two sandboxed native Electron launches', () => {
  const result = spawnSync(process.execPath, ['scripts/check-storage-relaunch.cjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('PASS native storage deletion and relaunch');
}, 65_000);
