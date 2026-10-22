import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../desktop/storage/database';
import { createChatStore } from '../../desktop/storage/chats';
import { createProjectStore } from '../../desktop/storage/projects';
import { createRunStore } from '../../desktop/storage/runs';
import { createMemoryStore } from '../../desktop/storage/memory';
import { extractMemory } from '../../desktop/memory/extract';
import { createMemoryQueue } from '../../desktop/memory/queue';
import type {
  SubscriptionAdapter,
  ProviderEvent,
  ProviderRequest,
} from '../../desktop/providers/types';
import type { MemoryUpdate } from '../../src/shared/domain';
const model = { providerId: 'chatgpt' as const, modelId: 'origin' };
const adapter = (
  stream: SubscriptionAdapter['stream'],
): SubscriptionAdapter => ({
  id: 'chatgpt',
  connect: async () => {},
  disconnect: async () => {},
  status: async () => 'connected',
  listModels: async () => [],
  stream,
});
describe('grounded extraction and durable queue', () => {
  let db: ReturnType<typeof openDatabase>, dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-memory-'));
    db = openDatabase(join(dir, 'test.db'));
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  function turn(
    text = 'Use SQLite',
    projectId: string | null = null,
    chatId?: string,
  ) {
    const chats = createChatStore(db),
      runs = createRunStore(db),
      chat = chatId ? chats.get(chatId)!.chat : chats.create(projectId);
    const run = runs.begin({
      requestId: crypto.randomUUID(),
      chatId: chat.id,
      text,
      model,
    });
    runs.appendDelta(run.id, 'I suggest SQLite');
    runs.finish(run.id, 'complete');
    return runs.get(run.id)!;
  }
  function update(
    run: ReturnType<typeof turn>,
    value = 'SQLite',
    quote = 'Use SQLite',
  ): MemoryUpdate {
    return {
      summary: 'Summary',
      facts: [
        {
          scope: { kind: 'global' },
          subject: 'user',
          key: 'database',
          value,
          keywords: ['database'],
          sourceMessageIds: [run.userMessageId],
          evidence: [{ messageId: run.userMessageId, quote }],
          kind: 'assertion',
        },
      ],
    };
  }
  function jsonAdapter(
    output: unknown,
    onRequest?: (r: ProviderRequest) => void,
  ) {
    return adapter(async function* (r) {
      onRequest?.(r);
      yield {
        type: 'delta',
        text: typeof output === 'string' ? output : JSON.stringify(output),
      };
      yield { type: 'done' };
    });
  }
  it('accepts user facts and sends known keys, ignores assistant-only and prior-summary evidence', async () => {
    const run = turn(),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!,
      input = memory.extractionInput(job.id)!;
    input.previousSummary = 'User likes Postgres';
    input.knownFacts = [
      {
        id: 'known',
        scope: { kind: 'global' },
        subject: 'user',
        key: 'canonical_key',
        value: 'old',
        status: 'deleted',
      },
    ];
    let prompt = '';
    const result = await extractMemory(
      input,
      jsonAdapter(update(run), (r) => {
        prompt = JSON.stringify(r);
        expect(r.model).toEqual(model);
      }),
      model,
      new AbortController().signal,
    );
    expect(result.facts[0].value).toBe('SQLite');
    expect(prompt).toContain('canonical_key');
    for (const output of [
      update(run, 'Postgres'),
      {
        ...update(run),
        facts: [
          {
            ...update(run).facts[0],
            sourceMessageIds: [run.assistantMessageId],
            evidence: [
              { messageId: run.assistantMessageId, quote: 'I suggest SQLite' },
            ],
          },
        ],
      },
    ])
      await expect(
        extractMemory(
          input,
          jsonAdapter(output),
          model,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
  });
  it('accepts explicit user adoption of prior complete assistant proposal', async () => {
    const first = turn('Suggest a database'),
      run = turn('Yes, use that', null, first.chatId),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!;
    const result = await extractMemory(
      memory.extractionInput(job.id)!,
      jsonAdapter(update(run, 'SQLite', 'Yes, use that')),
      model,
      new AbortController().signal,
    );
    expect(result.facts).toHaveLength(1);
  });
  it('rejects malformed, oversized, commands, quoted assertions, and ungrounded correction', async () => {
    const run = turn(),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!,
      input = memory.extractionInput(job.id)!;
    for (const output of [
      'not json',
      'x'.repeat(25000),
      { ...update(run), delete: ['all'] },
      {
        ...update(run),
        facts: [{ ...update(run).facts[0], kind: 'correction' }],
      },
    ])
      await expect(
        extractMemory(
          input,
          jsonAdapter(output),
          model,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    const quoted = turn('The document says Use SQLite'),
      quotedJob = memory.enqueue(quoted)!;
    await expect(
      extractMemory(
        memory.extractionInput(quotedJob.id)!,
        jsonAdapter(update(quoted, 'SQLite', 'Use SQLite')),
        model,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/quoted/i);
  });
  it('bounds input and rejects provider mismatch without calling provider', async () => {
    const run = turn('x'.repeat(50000)),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!;
    let calls = 0;
    const provider = jsonAdapter({ summary: '', facts: [] }, () => {
      calls++;
    });
    await expect(
      extractMemory(
        memory.extractionInput(job.id)!,
        provider,
        model,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/input/i);
    expect(calls).toBe(0);
    await expect(
      extractMemory(
        memory.extractionInput(job.id)!,
        provider,
        { providerId: 'claude', modelId: 'other' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/provider/i);
  });
  it('times out a hung next()/return() at 60 seconds and propagates cancellation', async () => {
    vi.useFakeTimers();
    const run = turn(),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!,
      input = memory.extractionInput(job.id)!;
    const hung = adapter(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: () => new Promise(() => {}),
      }),
    }));
    const timeout = expect(
      extractMemory(input, hung, model, new AbortController().signal),
    ).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(60000);
    await timeout;
    const c = new AbortController(),
      cancel = expect(
        extractMemory(input, hung, model, c.signal),
      ).rejects.toThrow(/abort/i);
    c.abort();
    await cancel;
  });
  it('captures one job per completed turn, origin model, and persists summary', async () => {
    const run = turn(),
      memory = createMemoryStore(db);
    let calls = 0;
    const queue = createMemoryQueue({
      db,
      memory,
      getAdapter: () =>
        jsonAdapter(update(run), (r) => {
          calls++;
          expect(r.model).toEqual(model);
        }),
    });
    queue.enqueue(run);
    queue.enqueue(run);
    await queue.drainForContext(
      { chatId: run.chatId, projectId: null, text: 'database' },
      new AbortController().signal,
    );
    await queue.stop();
    expect(calls).toBe(1);
    expect(memory.jobs()).toHaveLength(1);
    expect(memory.jobs()[0].state).toBe('complete');
    expect(memory.getSummary(run.chatId)?.text).toBe('Summary');
  });
  it('failed jobs do not spin; restart retries persisted jobs in per-chat order', async () => {
    const a = turn(),
      b = turn('Use SQLite', null, a.chatId);
    let calls = 0;
    let memory = createMemoryStore(db);
    let queue = createMemoryQueue({
      db,
      memory,
      getAdapter: () =>
        jsonAdapter('invalid', () => {
          calls++;
        }),
    });
    queue.enqueue(a);
    queue.enqueue(b);
    await new Promise((r) => setTimeout(r, 15));
    await queue.stop();
    expect(calls).toBe(1);
    expect(memory.jobs().map((j) => j.state)).toEqual(['failed', 'pending']);
    db.close();
    db = openDatabase(join(dir, 'test.db'));
    memory = createMemoryStore(db);
    const order: string[] = [];
    queue = createMemoryQueue({
      db,
      memory,
      getAdapter: () =>
        adapter(async function* (r) {
          const content = JSON.stringify(r.context);
          const run = content.includes(b.userMessageId) ? b : a;
          order.push(run.id);
          yield { type: 'delta', text: JSON.stringify(update(run)) };
          yield { type: 'done' };
        }),
    });
    queue.resume();
    await queue.drainForContext(
      { chatId: a.chatId, projectId: null, text: 'database' },
      new AbortController().signal,
    );
    await queue.stop();
    expect(memory.jobs().map((j) => j.state)).toEqual(['complete', 'complete']);
    expect(order).toEqual([a.id, b.id]);
  });
  it('pending global evidence crosses projects; drain waits at most 10 seconds', async () => {
    vi.useFakeTimers();
    const projects = createProjectStore(db),
      p = projects.create('A', []),
      other = projects.create('B', []),
      run = turn('I prefer SQLite globally', p.id),
      chat = createChatStore(db).create(other.id),
      memory = createMemoryStore(db);
    const hung = adapter(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<ProviderEvent>>(() => {}),
      }),
    }));
    const queue = createMemoryQueue({ db, memory, getAdapter: () => hung });
    queue.enqueue(run);
    const query = { chatId: chat.id, projectId: other.id, text: 'database' };
    expect(memory.pendingEvidence(query)[0].message.id).toBe(run.userMessageId);
    const wait = queue.drainForContext(query, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await wait).toEqual({ updating: true });
    await queue.stop();
    expect(memory.jobs()[0].state).toBe('failed');
  });
  it('retries failed extraction once on the next relevant context request', async () => {
    const run = turn(),
      memory = createMemoryStore(db);
    let succeed = false,
      calls = 0;
    const queue = createMemoryQueue({
      db,
      memory,
      getAdapter: () =>
        jsonAdapter(succeed ? update(run) : 'invalid', () => {
          calls++;
        }),
    });
    queue.enqueue(run);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(memory.jobs()[0].state).toBe('failed');
    succeed = true;
    vi.useFakeTimers();
    const waiting = queue.drainForContext(
      { chatId: run.chatId, projectId: null, text: 'database' },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(10000);
    await waiting;
    await queue.stop();
    expect(memory.jobs()[0].state).toBe('complete');
    expect(calls).toBe(2);
  });
  it('preserves forgotten keys across reopen, source deletion, reindex and late capture', async () => {
    const run = turn();
    let memory = createMemoryStore(db);
    const job = memory.enqueue(run)!;
    memory.apply(job.id, update(run));
    memory.forget(memory.list()[0].id);
    createChatStore(db).delete(run.chatId);
    db.close();
    db = openDatabase(join(dir, 'test.db'));
    memory = createMemoryStore(db);
    const next = turn(),
      nextJob = memory.enqueue(next)!;
    expect(memory.extractionInput(nextJob.id)!.knownFacts).toContainEqual(
      expect.objectContaining({
        subject: 'user',
        key: 'database',
        status: 'deleted',
      }),
    );
    memory.apply(nextJob.id, update(next));
    memory.rebuildIndex();
    expect(memory.list()).toEqual([]);
    expect(memory.searchIndex('SQLite')).toEqual([]);
  });
  it('startup captures completed turns missed between completion and enqueue', async () => {
    const run = turn(),
      memory = createMemoryStore(db),
      queue = createMemoryQueue({
        db,
        memory,
        getAdapter: () => jsonAdapter(update(run)),
      });
    queue.resume();
    await queue.drainForContext(
      { chatId: run.chatId, projectId: null, text: 'database' },
      new AbortController().signal,
    );
    await queue.stop();
    expect(memory.jobs()).toHaveLength(1);
    expect(memory.jobs()[0].state).toBe('complete');
  });
  it.each([
    ['No, do not use that', 'use that'],
    ['Yes, use that. Actually, no.', 'use that'],
    ['I reject the proposal to use that', 'use that'],
    ['No, do not use SQLite', 'use SQLite'],
    ["I don't prefer SQLite", 'prefer SQLite'],
    ['I can’t use SQLite', 'use SQLite'],
    ['Use SQLite? No, I reject it.', 'Use SQLite'],
  ])(
    'rejects evidence stripped from negative user context: %s',
    async (text, quote) => {
      const first = turn('Suggest a database');
      const run = turn(text, null, first.chatId);
      const memory = createMemoryStore(db),
        job = memory.enqueue(run)!;
      const output = update(run, 'SQLite', quote);
      await expect(
        extractMemory(
          memory.extractionInput(job.id)!,
          jsonAdapter(output),
          model,
          new AbortController().signal,
        ),
      ).rejects.toThrow(/evidence/i);
      expect(() => memory.apply(job.id, output)).toThrow(/evidence/i);
      expect(memory.list()).toEqual([]);
      expect(memory.getSummary(run.chatId)).toBeNull();
      expect(memory.getJob(job.id)?.state).toBe('pending');
    },
  );
  it('does not treat rejection of a proposal as adoption', async () => {
    const first = turn('Suggest a database'),
      run = turn('Yes, I reject that', null, first.chatId),
      memory = createMemoryStore(db),
      job = memory.enqueue(run)!;
    await expect(
      extractMemory(
        memory.extractionInput(job.id)!,
        jsonAdapter(update(run, 'SQLite', 'Yes, I reject that')),
        model,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/evidence/i);
  });
  it('cancels one chat immediately while unrelated extraction continues', async () => {
    const first = turn(),
      later = turn('Use SQLite', null, first.chatId),
      other = turn();
    const memory = createMemoryStore(db),
      signals: AbortSignal[] = [],
      captured: string[] = [];
    const provider = adapter((request, signal) => {
      signals.push(signal);
      const isFirst = JSON.stringify(request).includes(first.userMessageId);
      captured.push(isFirst ? first.chatId : other.chatId);
      if (isFirst)
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<ProviderEvent>>(() => {}),
          }),
        };
      return (async function* () {
        yield { type: 'delta' as const, text: JSON.stringify(update(other)) };
        yield { type: 'done' as const };
      })();
    });
    const queue = createMemoryQueue({ db, memory, getAdapter: () => provider });
    queue.enqueue(first);
    queue.enqueue(later);
    queue.enqueue(other);
    const cancelled = queue.cancelChat(first.chatId);
    expect(signals[0].aborted).toBe(true);
    await cancelled;
    createChatStore(db).delete(first.chatId);
    await queue.drainForContext(
      { chatId: other.chatId, projectId: null, text: 'database' },
      new AbortController().signal,
    );
    await queue.stop();
    expect(captured).toEqual([first.chatId, other.chatId]);
    expect(memory.jobs()).toHaveLength(1);
    expect(memory.jobs()[0].state).toBe('complete');
  });
  it('deleting during extraction cannot resurrect facts or summary', async () => {
    const run = turn(),
      memory = createMemoryStore(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const queue = createMemoryQueue({
      db,
      memory,
      getAdapter: () =>
        adapter(async function* () {
          await gate;
          yield { type: 'delta', text: JSON.stringify(update(run)) };
          yield { type: 'done' };
        }),
    });
    queue.enqueue(run);
    createChatStore(db).delete(run.chatId);
    release();
    await new Promise((r) => setTimeout(r, 10));
    await queue.stop();
    expect(memory.list()).toEqual([]);
    expect(memory.jobs()).toEqual([]);
    expect(memory.getSummary(run.chatId)).toBeNull();
  });
});
