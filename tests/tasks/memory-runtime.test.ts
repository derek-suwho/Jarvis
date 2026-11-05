import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDesktopStorage } from '../../desktop/runtime';
import { openDatabase } from '../../desktop/storage/database';

it('releases deleted-chat extraction exclusions before subsequent queue claims', async () => {
  const storage = openDesktopStorage(':memory:', {
    getAdapter: () => { throw new Error('Deleted evidence must never reach a provider'); },
  });
  const claim = vi.spyOn(storage.memory, 'claimNext');
  try {
    const deleted = Array.from({ length: 3 }, () => storage.chats.create(null));
    for (const chat of deleted) {
      await storage.chats.delete(chat.id);
      expect(storage.chats.get(chat.id)).toBeNull();
    }
    claim.mockClear();
    await storage.drainForContext!({ chatId: 'unrelated', projectId: null, text: 'database' },
      new AbortController().signal);
    expect(claim).toHaveBeenCalled();
    // Every claim copies this list and passes it into SQLite. Successful
    // deletions must not accumulate session-lifetime IDs in that list.
    expect(claim.mock.calls.every(([excluded]) => excluded?.length === 0)).toBe(true);
    expect(storage.memory.jobs()).toEqual([]);
  } finally {
    claim.mockRestore();
    await storage.close();
  }
});

it('persists memory provenance and forgetting through the desktop storage lifecycle', () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const project = storage.projects.create('Jarvis', []);
    const chat = storage.chats.create(project.id);
    const run = storage.runs.begin({
      requestId: crypto.randomUUID(), chatId: chat.id,
      text: 'Use SQLite', model: { providerId: 'chatgpt', modelId: 'origin' },
    });
    storage.runs.finish(run.id, 'complete');
    const job = storage.memory.enqueue(storage.runs.get(run.id)!)!;
    storage.memory.apply(job.id, { summary: 'Database choice', facts: [{
      scope: { kind: 'project', projectId: project.id }, subject: 'Jarvis',
      key: 'database', value: 'SQLite', keywords: ['database'], kind: 'assertion',
      sourceMessageIds: [run.userMessageId],
      evidence: [{ messageId: run.userMessageId, quote: 'Use SQLite' }],
    }] });
    const id = storage.memory.list()[0].id;
    storage.close();
    storage = openDesktopStorage(path);
    expect(storage.memory.searchIndex('SQLite')).toMatchObject([{
      id, scope: { kind: 'project', projectId: project.id },
      sourceMessageIds: [run.userMessageId], status: 'active',
    }]);
    expect(storage.chats.get(chat.id)!.messages[0].id).toBe(run.userMessageId);
    expect(storage.memory.getSummary(chat.id)?.text).toBe('Database choice');
    storage.memory.forget(id);
    storage.close();
    storage = openDesktopStorage(path);
    expect(storage.memory.searchIndex('SQLite')).toEqual([]);
    expect(storage.memory.get(id)?.status).toBe('deleted');
    storage.chats.delete(chat.id);
    expect(storage.memory.list()).toEqual([]);
    expect(storage.memory.jobs()).toEqual([]);
    expect(storage.memory.getSummary(chat.id)).toBeNull();
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('automatically persists exactly one extraction job for completed runtime runs across restart', () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const chat = storage.chats.create(null);
    const begin = (text: string) => storage.runs.begin({
      requestId: crypto.randomUUID(), chatId: chat.id, text,
      model: { providerId: 'claude', modelId: 'origin' },
    });
    const cancelled = begin('Do not remember this');
    storage.runs.finish(cancelled.id, 'cancelled');
    storage.runs.finish(cancelled.id, 'complete');
    expect(storage.memory.jobs()).toEqual([]);
    const complete = begin('I prefer concise answers');
    storage.runs.appendDelta(complete.id, 'Understood');
    storage.runs.finish(complete.id, 'complete');
    storage.runs.finish(complete.id, 'complete');
    expect(storage.memory.jobs()).toHaveLength(1);
    const job = storage.memory.jobs()[0];
    expect(job).toMatchObject({ chatId: chat.id, model: complete.model });
    storage.close();
    storage = openDesktopStorage(path);
    expect(storage.memory.jobs()).toEqual([job]);
    expect(storage.memory.extractionInput(job.id)?.snapshot.messages.map(m => m.content))
      .toContain('I prefer concise answers');
    storage.chats.delete(chat.id);
    expect(storage.memory.jobs()).toEqual([]);
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('executes recovered and new extraction jobs through the runtime provider and stops before closing storage', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const chat = storage.chats.create(null);
    const begin = () => storage.runs.begin({
      requestId: crypto.randomUUID(), chatId: chat.id, text: 'Use SQLite',
      model: { providerId: 'claude', modelId: 'origin' },
    });
    const recovered = begin();
    storage.runs.finish(recovered.id, 'complete');
    await storage.close();
    const requests: string[] = [];
    storage = openDesktopStorage(path, {
      getAdapter(providerId) {
        expect(providerId).toBe('claude');
        return {
          id: providerId, connect: async () => {}, disconnect: async () => {},
          status: async () => 'connected', listModels: async () => [],
          async *stream(request) {
            expect(request.model).toEqual(recovered.model);
            const input = JSON.parse(request.context.messages[0].content);
            const message = input.messages.find((m: { role: string; sequence: number }) =>
              m.role === 'user' && m.sequence > input.afterSequence);
            requests.push(message.id);
            yield { type: 'delta', text: JSON.stringify({ summary: 'Database choice', facts: [{
              scope: { kind: 'project', projectId: null }, subject: 'Jarvis', key: 'database',
              value: 'SQLite', keywords: ['database'], kind: 'assertion',
              sourceMessageIds: [message.id], evidence: [{ messageId: message.id, quote: 'Use SQLite' }],
            }] }) };
            yield { type: 'done' };
          },
        };
      },
    });
    await expect.poll(() => storage.memory.jobs().map(j => j.state)).toEqual(['complete']);
    expect(storage.memory.searchIndex('SQLite')).toHaveLength(1);
    const next = begin();
    storage.runs.finish(next.id, 'complete');
    await expect.poll(() => storage.memory.jobs().every(j => j.state === 'complete')).toBe(true);
    expect(requests).toEqual([recovered.userMessageId, next.userMessageId]);
    await storage.close();
    storage = openDesktopStorage(path);
    expect(storage.memory.getSummary(chat.id)?.text).toBe('Database choice');
    expect(storage.memory.searchIndex('SQLite')).toHaveLength(1);
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('aborts active runtime extraction before closing the database and preserves retryable work', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  const path = join(dir, 'jarvis.db');
  let entered = false;
  let aborted = false;
  let storage = openDesktopStorage(path, {
    getAdapter: () => ({
      id: 'claude', connect: async () => {}, disconnect: async () => {},
      status: async () => 'connected', listModels: async () => [],
      async *stream(_request, signal) {
        entered = true;
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
        });
        yield { type: 'done' };
      },
    }),
  });
  try {
    const chat = storage.chats.create(null);
    const run = storage.runs.begin({
      requestId: crypto.randomUUID(), chatId: chat.id, text: 'Use SQLite',
      model: { providerId: 'claude', modelId: 'origin' },
    });
    storage.runs.finish(run.id, 'complete');
    await expect.poll(() => entered).toBe(true);
    await storage.close();
    expect(aborted).toBe(true);
    storage = openDesktopStorage(path);
    expect(storage.memory.jobs()).toMatchObject([{ state: 'failed', runId: run.id }]);
    expect(storage.memory.list()).toEqual([]);
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('fences active extraction before deleting a runtime chat and its durable memory', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  let entered = false;
  let aborted = false;
  let evidencePresentAtAbort = false;
  const storage = openDesktopStorage(join(dir, 'jarvis.db'), {
    getAdapter: () => ({
      id: 'claude', connect: async () => {}, disconnect: async () => {},
      status: async () => 'connected', listModels: async () => [],
      async *stream(_request, signal) {
        entered = true;
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => {
            aborted = true;
            evidencePresentAtAbort = storage.chats.list().length === 1;
            resolve();
          }, { once: true });
        });
        yield { type: 'done' };
      },
    }),
  });
  try {
    const chat = storage.chats.create(null);
    const run = storage.runs.begin({
      requestId: crypto.randomUUID(), chatId: chat.id, text: 'Use SQLite',
      model: { providerId: 'claude', modelId: 'origin' },
    });
    storage.runs.finish(run.id, 'complete');
    await expect.poll(() => entered).toBe(true);
    await storage.chats.delete(chat.id);
    expect(aborted).toBe(true);
    expect(evidencePresentAtAbort).toBe(true);
    expect(storage.chats.get(chat.id)).toBeNull();
    expect(storage.runs.get(run.id)).toBeNull();
    expect(storage.memory.jobs()).toEqual([]);
    expect(storage.memory.list()).toEqual([]);
    expect(storage.memory.getSummary(chat.id)).toBeNull();
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('cancels deleted-project extraction after a chat moves and preserves other-project work', async () => {
  let entered = false;
  let aborted = false;
  const storage = openDesktopStorage(':memory:', {
    getAdapter: () => ({
      id: 'claude', connect: async () => {}, disconnect: async () => {},
      status: async () => 'connected', listModels: async () => [],
      async *stream(_request, signal) {
        entered = true;
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
        });
        yield { type: 'done' };
      },
    }),
  });
  try {
    const deleted = storage.projects.create('Private', []);
    const kept = storage.projects.create('Kept', []);
    const run = storage.beginShippingTurn({ requestId: crypto.randomUUID(), chatId: 'moved',
      text: 'Private project evidence', model: { providerId: 'claude', modelId: 'origin' },
    }, deleted);
    storage.runs.finish(run.id, 'complete');
    await expect.poll(() => entered).toBe(true);
    const other = storage.beginShippingTurn({ requestId: crypto.randomUUID(), chatId: 'moved',
      text: 'Kept project evidence', model: run.model,
    }, kept);
    await storage.projects.delete(deleted.id);
    expect(aborted).toBe(true);
    expect(storage.runs.get(run.id)).toBeNull();
    expect(storage.runs.get(other.id)).not.toBeNull();
    expect(storage.chats.get('moved')?.chat.projectId).toBe(kept.id);
    expect(storage.memory.jobs()).toEqual([]);
    expect(storage.memory.list()).toEqual([]);
  } finally {
    await storage.close();
  }
});

it('does not restore a deleted runtime chat from the renderer checkpoint after reopening storage', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-runtime-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const deleted = storage.chats.create(null);
    const kept = storage.chats.create(null);
    const run = storage.runs.begin({ requestId: crypto.randomUUID(), chatId: deleted.id,
      text: 'Private evidence', model: { providerId: 'claude', modelId: 'origin' } });
    storage.runs.finish(run.id, 'complete');
    const archive = [deleted, kept].map(chat => ({ id: chat.id, title: chat.title, updatedAt: 1,
      messages: [{ id: `${chat.id}-user`, role: 'user' as const, content: 'Private evidence' }] }));
    storage.checkpoints.save(archive);
    await storage.chats.delete(deleted.id);
    await storage.close();
    storage = openDesktopStorage(path);
    expect(storage.checkpoints.load()).toEqual([archive[1]]);
    expect(storage.chats.get(deleted.id)).toBeNull();
    expect(storage.runs.get(run.id)).toBeNull();
    expect(storage.memory.jobs()).toEqual([]);
    expect(storage.chats.get(kept.id)).not.toBeNull();
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


it('resumes extraction after failed chat deletion and checkpoint repair', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.memory-delete-recovery-'));
  const path = join(dir, 'jarvis.db');
  const storage = openDesktopStorage(path, {
    getAdapter: () => ({
      id: 'claude', connect: async () => {}, disconnect: async () => {},
      status: async () => 'connected', listModels: async () => [],
      async *stream() {
        yield { type: 'delta', text: JSON.stringify({ summary: 'Recovered', facts: [] }) };
        yield { type: 'done' };
      },
    }),
  });
  try {
    const chat = storage.chats.create(null);
    const inspection = openDatabase(path);
    try {
      inspection.prepare('INSERT INTO renderer_checkpoint(id, chats_json) VALUES (1, ?)').run('{broken');
    } finally { inspection.close(); }
    await expect(storage.chats.delete(chat.id)).rejects.toThrow('Stored checkpoint archive is invalid.');
    expect(storage.chats.get(chat.id)).not.toBeNull();
    storage.checkpoints.save([]);
    const run = storage.runs.begin({ requestId: 'after-repair', chatId: chat.id,
      text: 'Continue after repair', model: { providerId: 'claude', modelId: 'origin' } });
    storage.runs.finish(run.id, 'complete');
    await expect.poll(() => storage.memory.jobs().map(job => job.state)).toEqual(['complete']);
    expect(storage.memory.getSummary(chat.id)?.text).toBe('Recovered');
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
