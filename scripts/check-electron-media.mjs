import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

// A separate Electron process/profile exercises the shipped preload and IPC handlers.
// Provider HTTP is captured in that process; credentials and real tools are never used.
const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-electron-media-'));
try {
  const child = spawn(electron, [
    'scripts/check-electron-media.cjs', directory,
    process.env.JARVIS_TEST_URL || 'http://localhost:3000',
  ], { stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, 'Electron media IPC check failed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
