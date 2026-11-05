import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDesktopStorage } from '../../desktop/runtime';
const require = createRequire(import.meta.url);

it('extracts grounded durable memory through the shipping provider attempt interface', async () => {
  const { createMemoryAdapter } = require('../../electron/memory-adapter.cjs');
  const dir = mkdtempSync(join(process.cwd(), '.memory-adapter-'));
  const storage = openDesktopStorage(join(dir, 'jarvis.db'), {
    getAdapter: provider => createMemoryAdapter(provider, (input: any, emit: any) => {
      expect(input.provider).toBe('claude');
      expect(input.request.model).toBe('origin');
      expect(input.updates).toEqual([]);
      expect(input.toolsDisabled).toBe(true);
      expect(input.request.mode).toBe('chat');
      expect(input.request.messages[0]).toMatchObject({ role: 'user' });
      expect(input.request.messages[0].content).toContain('Extract durable memory');
      const transcript = JSON.parse(input.request.messages[1].content);
      const message = transcript.messages.find((m: any) => m.role === 'user');
      emit({ type: 'delta', text: JSON.stringify({ summary: 'Preference', facts: [{
        scope: { kind: 'global' }, subject: 'User', key: 'style', value: 'concise',
        keywords: ['style'], kind: 'assertion', sourceMessageIds: [message.id],
        evidence: [{ messageId: message.id, quote: 'I prefer concise answers' }],
      }] }) });
      return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
    }),
  });
  try {
    const chat = storage.chats.create(null);
    const run = storage.runs.begin({ requestId: 'request', chatId: chat.id,
      text: 'I prefer concise answers', model: { providerId: 'claude', modelId: 'origin' } });
    storage.runs.finish(run.id, 'complete');
    await expect.poll(() => storage.memory.jobs()[0]?.state).toBe('complete');
    expect(storage.memory.searchIndex('concise')).toMatchObject([{ sourceMessageIds: [run.userMessageId] }]);
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('stops an extraction attempt on abort even if provider settlement stalls', async () => {
  const { createMemoryAdapter } = require('../../electron/memory-adapter.cjs');
  let stopped = 0;
  const controller = new AbortController();
  const adapter = createMemoryAdapter('gemini', () => ({
    settled: new Promise(() => {}), stop() { stopped++; },
  }));
  const iterator = adapter.stream({ model: { providerId: 'gemini', modelId: 'origin' },
    context: { instructions: 'Extract', messages: [], memoryIds: [], updating: false } }, controller.signal);
  const next = iterator.next();
  controller.abort();
  await expect(next).rejects.toThrow();
  expect(stopped).toBe(1);
});

it.each(['failed', 'interrupted'])('rejects %s extraction outcomes without publishing partial memory', async kind => {
  const { createMemoryAdapter } = require('../../electron/memory-adapter.cjs');
  const adapter = createMemoryAdapter('grok', (_input: any, emit: any) => {
    emit({ type: 'delta', text: '{"summary":"partial","facts":[]}' });
    return { settled: Promise.resolve({ kind }), stop() {} };
  });
  const iterator = adapter.stream({ model: { providerId: 'grok', modelId: 'origin' },
    context: { instructions: 'Extract', messages: [], memoryIds: [], updating: false } }, new AbortController().signal);
  await expect(iterator.next()).rejects.toThrow('did not complete');
});

it.each([
  { type: 'tool', name: 'unexpected' },
  { type: 'delta', text: 'x'.repeat(24 * 1024 + 1) },
])('rejects invalid extraction output without waiting for provider settlement ($type)', async event => {
  const { createMemoryAdapter } = require('../../electron/memory-adapter.cjs');
  let emit: (event: any) => void = () => {};
  let stopped = 0;
  const controller = new AbortController();
  const adapter = createMemoryAdapter('claude', (_input: any, receive: any) => {
    emit = receive;
    return { settled: new Promise(() => {}), stop() { stopped++; } };
  });
  const iterator = adapter.stream({ model: { providerId: 'claude', modelId: 'origin' },
    context: { instructions: 'Extract', messages: [], memoryIds: [], updating: false } }, controller.signal);
  const outcome = iterator.next().then(() => 'resolved', (error: Error) => error.message);
  try {
    emit(event);
    const result = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('stalled'), 100))]);
    expect(result).toBe(event.type === 'tool' ? 'Extraction attempted a tool' : 'Extraction output exceeds byte limit');
    expect(stopped).toBe(1);
  } finally {
    controller.abort();
    await outcome;
  }
});

it('stops the returned extraction handle when cancellation occurs while opening the provider', async () => {
  const { createMemoryAdapter } = require('../../electron/memory-adapter.cjs');
  const controller = new AbortController();
  let stopped = 0;
  const adapter = createMemoryAdapter('claude', () => {
    controller.abort();
    return { settled: new Promise(() => {}), stop() { stopped++; } };
  });
  const iterator = adapter.stream({ model: { providerId: 'claude', modelId: 'origin' },
    context: { instructions: 'Extract', messages: [], memoryIds: [], updating: false } }, controller.signal);
  await expect(iterator.next()).rejects.toThrow('Extraction aborted');
  expect(stopped).toBe(1);
});
