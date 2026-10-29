import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';

// This is intentionally excluded from npm test: enabling it uses the signed-in Claude account.
if (process.env.JARVIS_LIVE_CLAUDE_TEST !== '1') {
  console.log('SKIP: set JARVIS_LIVE_CLAUDE_TEST=1 explicitly to test real Claude interruption/resume. Uses your Claude account.');
  process.exit(0);
}

const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-claude-interrupt-'));
const adapterUrl = new URL('../electron/claude-code.cjs', import.meta.url);
const require = createRequire(adapterUrl);
const emptyTools = path.join(directory, 'empty-mcp.json');
await writeFile(emptyTools, JSON.stringify({ mcpServers: {} }));
const module = { exports: {} };
const children = new Set();
const nativeProcesses = require('node:child_process');
let binary;
runInNewContext(await readFile(adapterUrl, 'utf8'), {
  module, process, AbortController,
  require(name) {
    if (name === 'electron') return { app: { getPath: () => directory } };
    if (name === './tools/index.cjs') return {
      claudeMcpConfigFile: async () => ({ file: emptyTools, names: [] }),
      labelTool: (tool) => ({ server: 'Unexpected tool', tool }),
    };
    if (name === 'node:child_process') return {
      ...nativeProcesses,
      spawn(file, args, options) {
        binary = file;
        const child = nativeProcesses.spawn(file, args, options);
        children.add(child);
        child.once('close', (code, signal) => {
          children.delete(child);
          console.log(JSON.stringify({ event: 'exit', code, signal }));
        });
        child.stdout.on('data', (chunk) => {
          // Do not print prompts, output, or session contents. The adapter parses the actual stream.
          if (chunk.toString().includes('"type":"result"')) console.log(JSON.stringify({ event: 'result-observed' }));
        });
        return child;
      },
    };
    return require(name);
  },
});

const word = `JARVIS_${Date.now().toString(36)}`;
const request = {
  model: process.env.JARVIS_CLAUDE_TEST_MODEL || 'sonnet',
  mode: 'chat', reasoning: 'Low', conversationId: `test-${Date.now()}`,
  messages: [{ role: 'user', content: `Remember this exact word: ${word}. Then count from 1 to 1000, one number per line. Do not use tools.` }],
};
let current;
let interrupted = false;
const timeout = setTimeout(() => {
  current?.stop();
  for (const child of children) child.kill('SIGTERM');
}, 90000);

try {
  current = module.exports.openAttempt({ request, updates: [], attemptId: 'initial' }, (event) => {
    assert.notEqual(event.type, 'tool', 'this compatibility check must remain tools-disabled');
    if (!interrupted && event.type === 'delta' && event.text) {
      interrupted = true;
      current.interrupt();
    }
  });
  const first = await current.settled;
  assert.equal(first.kind, 'interrupted', first.error || 'Claude did not acknowledge interruption');
  assert.ok(first.continuation?.sessionId, 'No confirmed session to resume');
  const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 5000 });
  console.log(JSON.stringify({ event: 'version', version: stdout.trim() }));
  let output = '';
  current = module.exports.openAttempt({
    request, continuation: first.continuation, attemptId: 'resumed',
    updates: [{ role: 'user', content: 'Stop counting. Reply with the exact word I asked you to remember, followed by RESUMED. Nothing else.' }],
  }, (event) => {
    assert.notEqual(event.type, 'tool', 'this compatibility check must remain tools-disabled');
    if (event.type === 'delta') output += event.text;
  });
  const second = await current.settled;
  assert.equal(second.kind, 'complete', second.error || 'Resumed Claude attempt failed');
  assert.ok(output.includes(word) && output.includes('RESUMED'), 'The resumed session did not retain original context and apply the queued direction');
  console.log('PASS: actual CLI acknowledged SIGINT, exited before continuation, resumed the exact session, and retained context. Text-only; tool interruption remains covered by fixtures.');
} finally {
  clearTimeout(timeout);
  current?.stop();
  for (const child of children) child.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
}
