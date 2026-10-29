import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-task-lifecycle-'));
const environment = { ...process.env, JARVIS_TASK_TEST_DIR: directory };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(require('electron'), [fileURLToPath(new URL('../tests/fixtures/task-lifecycle.cjs', import.meta.url))], {
    env: environment, stdio: 'inherit',
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
  clearTimeout(timeout);
  if (code !== 0) throw new Error(`Electron task lifecycle test exited ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
