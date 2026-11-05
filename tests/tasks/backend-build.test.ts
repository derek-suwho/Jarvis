import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it('loads the built CommonJS desktop backend and reopens durable checkpoints', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.backend-build-test-'));
  let runtime: any;
  try {
    const script = '../../scripts/build-backend.mjs';
    const { buildBackend } = await import(script);
    await buildBackend(join(dir, 'bundle'));
    const { openDesktopStorage } = require(join(dir, 'bundle/storage.cjs'));
    const path = join(dir, 'archive.sqlite');
    runtime = openDesktopStorage(path);
    expect(runtime.checkpoints.load()).toBeNull();
    const chats = [{ id: 'chat', title: 'Continue with Claude', updatedAt: 1, messages: [
      { id: 'reply', role: 'assistant', content: 'Partial answer', model: 'ChatGPT', taskId: 'task', attemptId: 'attempt' },
    ] }];
    runtime.checkpoints.save(chats);
    runtime.close();
    runtime = openDesktopStorage(path);
    expect(runtime.checkpoints.load()).toEqual(chats);
    runtime.checkpoints.save([]);
    runtime.close();
    runtime = openDesktopStorage(path);
    expect(runtime.checkpoints.load()).toEqual([]);
  } finally {
    runtime?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
