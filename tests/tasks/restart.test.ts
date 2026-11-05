import { afterEach, expect, it, vi } from 'vitest';
import { loadChats, saveChats } from '../../src/lib/chats';
import { recoverInterruptedMessages } from '../../src/lib/taskProjection';
import { buildReplyHistory } from '../../src/lib/replyContext';
import type { Chat } from '../../src/lib/chats';

vi.mock('../../src/lib/mediaStore', () => ({
  writeMedia: vi.fn().mockResolvedValue(undefined),
  pruneMedia: vi.fn().mockResolvedValue(undefined),
  readMedia: vi.fn().mockResolvedValue([]),
}));
afterEach(() => vi.unstubAllGlobals());

it('recovers abandoned persisted tools after restart even when the reply already has an outcome', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const saved: Chat[] = [{ id: 'chat', title: 'Provider continuation', updatedAt: 1, messages: [{
    id: 'reply', role: 'assistant', content: 'Partial result retained', taskId: 'lost', attemptId: 'old',
    outcome: 'interrupted', tools: [
      { id: 'running', server: 'local', tool: 'search', status: 'running' },
      { id: 'done', server: 'local', tool: 'read', status: 'done' },
    ],
  }] }];
  await saveChats(saved);
  const restored = loadChats();
  const recovered = recoverInterruptedMessages(restored, []);
  expect(recovered[0].messages[0]).toMatchObject({
    content: 'Partial result retained', outcome: 'interrupted',
    tools: [{ id: 'running', status: 'error' }, { id: 'done', status: 'done' }],
  });
  expect(restored).toEqual(saved);
  await saveChats(recovered);
  expect(recoverInterruptedMessages(loadChats(), [])).toEqual(recovered);
});

it('retains disclosed partial context when a saved conversation resumes with another provider', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  await saveChats([{ id: 'switch', title: 'Continue', updatedAt: 1, messages: [
    { id: 'question', role: 'user', content: 'Compare the options' },
    { id: 'partial', role: 'assistant', content: 'Option A is faster', model: 'ChatGPT', taskId: 'lost', attemptId: 'old' },
    { id: 'queued', role: 'user', content: 'Unsent instruction', taskId: 'lost', delivery: 'queued' },
  ] }]);
  const recovered = recoverInterruptedMessages(loadChats(), []);
  await saveChats(recovered);
  const restored = loadChats();
  const original = structuredClone(restored);
  const context = buildReplyHistory([
    ...restored[0].messages,
    { id: 'followup', role: 'user', content: 'Claude, finish the comparison' },
  ], 'Be concise');
  expect(context).toEqual([
    { role: 'user', content: 'User-provided instructions for this conversation:\nBe concise\n\nUser message:\nCompare the options' },
    { role: 'assistant', content: '[Incomplete interrupted response]\nOption A is faster' },
    { role: 'user', content: 'Claude, finish the comparison' },
  ]);
  expect(restored).toEqual(original);
});
