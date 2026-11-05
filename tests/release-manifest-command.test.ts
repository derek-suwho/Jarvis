import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('generates verifiable artifact checksums through the documented npm command and fails on empty output', async () => {
  const root = mkdtempSync(join(process.cwd(), '.release-manifest-'));
  const execute = promisify(execFile);
  const run = async () => {
    try {
      return { ...await execute(process.execPath, [process.env.npm_execpath!, 'run', '--silent', 'release:manifest', '--', root], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
      }), status: 0 };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return { status: failure.code, stdout: failure.stdout, stderr: failure.stderr };
    }
  };
  try {
    writeFileSync(join(root, 'Jarvis-0.1.0-arm64.zip'), 'fixture installer bytes');
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    const digest = createHash('sha256').update('fixture installer bytes').digest('hex');
    expect(result.stdout).toBe(`${digest}  Jarvis-0.1.0-arm64.zip\n`);
    rmSync(join(root, 'Jarvis-0.1.0-arm64.zip'));
    const empty = await run();
    expect(empty.status).toBe(1);
    expect(empty.stdout).toBe('');
    expect(empty.stderr).toMatch(/no artifacts found/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
