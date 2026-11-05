import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createTaskCoordinator } = require('../../electron/tasks/coordinator.cjs');

function request(id = 'a', provider = 'chatgpt', mode = 'chat') {
  return { requestId: `send-${id}`, target: { kind: 'chat', id, generation: id, ephemeral: false },
    title: id, provider, mode, model: 'model', modelLabel: 'Model', history: [], instructions: 'Keep context',
    input: { id: `u-${id}`, role: 'user', content: 'Original task' } };
}
function harness() {
  const attempts: any[] = [], events: any[] = [], outcomes: any[] = [];
  const runtime = createTaskCoordinator({
    emit: (event: any) => events.push(event), onOutcome: (task: any) => outcomes.push(task),
    openAttempt(input: any, emit: any) {
      let resolve: any, reject: any;
      const item = { input, emit, interrupted: 0, stopped: 0, finish: (result: any = { kind: 'complete', continuation: {} }) => resolve(result), fail: (error?: any) => reject(error) };
      attempts.push(item);
      return { settled: new Promise((r, j) => { resolve = r; reject = j; }), interrupt: () => { item.interrupted++; }, stop: () => { item.stopped++; } };
    },
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { runtime, attempts, events, outcomes, flush };
}
const update = (taskId: string, id: string) => ({ taskId, entryId: id, message: { id, role: 'user', content: id } });

describe('main task coordinator', () => {
  it('keeps captured project scope in receipts and events after a chat moves', async () => {
    const h = harness();
    try {
      const original = { ...request('moving'), project: { id: 'design', name: 'Design' } };
      const first = await h.runtime.start(original);
      expect(first.ok).toBe(true);
      expect(first.task.project).toEqual({ id: 'design', name: 'Design' });
      original.project.id = 'engineering';
      first.task.project.id = 'receipt-mutation';
      h.attempts[0].finish(); await h.flush();
      const next = await h.runtime.start({ ...request('moving'), requestId: 'moved-turn',
        project: { id: 'engineering', name: 'Engineering' } });
      expect(next.ok).toBe(true);
      const snapshots = h.runtime.snapshot();
      expect(snapshots.find((task: any) => task.id === first.task.id).project)
        .toEqual({ id: 'design', name: 'Design' });
      expect(snapshots.find((task: any) => task.id === next.task.id).project)
        .toEqual({ id: 'engineering', name: 'Engineering' });
      expect(h.events.filter((event: any) => event.task?.id === first.task.id)
        .every((event: any) => event.task.project.id === 'design')).toBe(true);
      h.attempts[1].finish(); await h.flush();
      const general = await h.runtime.start({ ...request('moving'), requestId: 'general-turn' });
      expect(general.ok).toBe(true);
      expect(general.task.project).toBeUndefined();
      expect(h.runtime.snapshot().find((task: any) => task.id === first.task.id).project.id).toBe('design');
    } finally { h.runtime.shutdown(); await h.flush(); }
  });

  it('bounds accumulated attachment bytes while switching sequentially across all providers', async () => {
    const h = harness();
    const pdf = Buffer.alloc(8 * 1024 * 1024, 32);
    pdf.write('%PDF-1.7');
    pdf.write('%%EOF', pdf.length - 5);
    const attachment = { name: 'history.pdf', type: 'application/pdf', data: pdf.toString('base64') };
    const history: any[] = [
      { id: 'old-file', role: 'user', content: 'Old document', attachments: [attachment] },
      { id: 'recent-file', role: 'user', content: 'Recent document', attachments: [attachment] },
    ];
    for (const [index, provider] of ['chatgpt', 'claude', 'gemini', 'grok'].entries()) {
      const original = structuredClone(history);
      const started = await h.runtime.start({ ...request('file-switch', provider),
        requestId: `file-switch-${index}`, history,
        input: { id: `file-input-${index}`, role: 'user', content: `Continue with ${provider}`,
          attachments: [{ name: 'current.txt', text: 'Current file contents' }] } });
      expect(started.ok).toBe(true);
      expect(h.attempts).toHaveLength(index + 1);
      const messages = h.attempts[index].input.request.messages;
      expect(Buffer.byteLength(JSON.stringify(messages))).toBeLessThanOrEqual(20 * 1024 * 1024);
      expect(messages[0]).toEqual({ role: 'user',
        content: 'User-provided instructions for this conversation:\nKeep context\n\nUser message:\nRecent document',
        media: [attachment] });
      expect(messages.at(-1).content).toContain(`Continue with ${provider}`);
      expect(messages.at(-1).content).toContain('Current file contents');
      if (index) expect(messages.at(-2).content).toBe(`File reply ${index - 1}`);
      expect(history).toEqual(original);
      h.attempts[index].emit({ type: 'delta', text: `File reply ${index}` });
      h.attempts[index].finish(); await h.flush();
      const task = h.runtime.snapshot().find((t: any) => t.id === started.task.id);
      expect(task.state).toBe('complete');
      history.push(...task.messages);
    }
    h.runtime.shutdown();
  });

  it.each(['chatgpt', 'claude', 'gemini', 'grok'])('bounds accumulated text when switching to %s while preserving the current input', async (provider) => {
    const h = harness();
    const history = [
      { id: 'old', role: 'user', content: 'x'.repeat(300_000) },
      { id: 'recent', role: 'assistant', content: 'y'.repeat(110_000) },
    ];
    const original = structuredClone(history);
    const started = await h.runtime.start({ ...request('text-switch', provider), history });
    expect(started.ok).toBe(true);
    expect(h.attempts).toHaveLength(1);
    expect(h.attempts[0].input.request.messages).toEqual([
      { role: 'assistant', content: history[1].content },
      { role: 'user', content: 'User-provided instructions for this conversation:\nKeep context\n\nUser message:\nOriginal task' },
    ]);
    expect(history).toEqual(original);
    h.attempts[0].finish(); await h.flush();
    expect(h.runtime.snapshot()[0].state).toBe('complete');
    // An oversized current input must still fail rather than being silently truncated.
    const oversized = await h.runtime.start({ ...request('oversized', provider), history,
      input: { id: 'large-input', role: 'user', content: 'z'.repeat(400_001) } });
    expect(oversized).toMatchObject({ ok: false, code: 'invalid_request', message: 'Conversation is too long to send.' });
    expect(h.attempts).toHaveLength(1);
    h.runtime.shutdown();
  });

  it('switches sequentially across all providers after shared history reaches the message limit', async () => {
    const h = harness();
    const history: any[] = Array.from({ length: 199 }, (_, i) => ({
      id: `old-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Shared turn ${i}`,
    }));
    for (const [index, provider] of ['chatgpt', 'claude', 'gemini', 'grok'].entries()) {
      const original = structuredClone(history);
      const started = await h.runtime.start({ ...request('same-chat', provider),
        requestId: `switch-${index}`, history,
        input: { id: `switch-input-${index}`, role: 'user', content: `Continue with ${provider}` } });
      expect(started.ok).toBe(true);
      expect(h.attempts).toHaveLength(index + 1);
      const messages = h.attempts[index].input.request.messages;
      expect(messages).toHaveLength(200);
      expect(messages.at(-1)).toEqual({ role: 'user', content: `Continue with ${provider}` });
      expect(messages.some((m: any) => m.content.includes('Keep context'))).toBe(true);
      if (index) expect(messages.at(-2)).toEqual({ role: 'assistant', content: `Reply ${index - 1}` });
      expect(history).toEqual(original);
      h.attempts[index].emit({ type: 'delta', text: `Reply ${index}` });
      h.attempts[index].finish(); await h.flush();
      const task = h.runtime.snapshot().find((t: any) => t.id === started.task.id);
      expect(task.state).toBe('complete');
      history.push(...task.messages);
    }
    expect(history).toHaveLength(207);
    h.runtime.shutdown();
  });

  it.each(['chatgpt', 'claude', 'gemini', 'grok'])('dispatches bounded shared history to %s without counting an unsent reply', async (provider) => {
    const h = harness();
    const history = Array.from({ length: 199 }, (_, i) => ({
      id: `history-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Shared turn ${i}`,
    }));
    const original = structuredClone(history);
    const started = await h.runtime.start({ ...request('switch', provider), history });
    await h.flush();

    expect(started.ok).toBe(true);
    expect(h.attempts).toHaveLength(1);
    expect(h.attempts[0].input.provider).toBe(provider);
    const messages = h.attempts[0].input.request.messages;
    expect(messages).toHaveLength(200);
    expect(messages[0]).toEqual({ role: 'user', content: 'User-provided instructions for this conversation:\nKeep context\n\nUser message:\nShared turn 0' });
    expect(messages[198]).toEqual({ role: 'user', content: 'Shared turn 198' });
    expect(messages[199]).toEqual({ role: 'user', content: 'Original task' });
    expect(history).toEqual(original);
    h.attempts[0].emit({ type: 'delta', text: 'Continued shared history' });
    h.attempts[0].finish(); await h.flush();
    expect(h.runtime.snapshot()[0].state).toBe('complete');
    h.runtime.shutdown();
  });

  it('settles a synchronous provider-start failure and permits retry in the same chat', async () => {
    const outcomes: any[] = [];
    let starts = 0;
    const runtime = createTaskCoordinator({
      onOutcome: (task: any) => outcomes.push(task),
      openAttempt() {
        starts++;
        if (starts === 1) throw undefined;
        return { settled: Promise.resolve({ kind: 'complete' }), stop() {}, interrupt() {} };
      },
    });
    const first = await runtime.start(request('a', 'claude', 'code'));
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(first.ok).toBe(true);
    expect(runtime.snapshot()[0]).toMatchObject({ state: 'failed', error: 'Provider failed.' });
    expect(runtime.snapshot()[0].messages.at(-1)).toMatchObject({ outcome: 'failed' });
    expect(outcomes).toHaveLength(1);
    const retry = await runtime.start({ ...request('a', 'claude', 'code'), requestId: 'retry-a' });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(retry.ok).toBe(true);
    expect(starts).toBe(2);
    expect(runtime.snapshot().find((task: any) => task.id === retry.task.id).state).toBe('complete');
    expect(outcomes).toHaveLength(2);
    runtime.shutdown();
  });

  it('settles a disconnect rejection without an Error and releases the scheduler slot', async () => {
    const h = harness(), a = await h.runtime.start(request());
    await h.runtime.queue(update(a.task.id, 'preserved'));
    await h.runtime.start(request('b', 'claude'));
    await h.runtime.start(request('c', 'gemini'));
    await h.runtime.start(request('d', 'grok'));
    expect(h.attempts).toHaveLength(3);

    h.attempts[0].fail(); await h.flush();

    const task = h.runtime.snapshot().find((t: any) => t.id === a.task.id);
    expect(task).toMatchObject({ state: 'failed', error: 'Provider failed.', queue: [{ state: 'queued' }] });
    expect(task.messages.find((m: any) => m.role === 'assistant')).toMatchObject({ content: '', outcome: 'failed' });
    expect(h.outcomes).toHaveLength(1);
    expect(h.attempts).toHaveLength(4);
    expect(h.attempts[3].input.provider).toBe('grok');
    for (const attempt of h.attempts.slice(1)) attempt.finish();
    await h.flush();
  });

  it.each(['chatgpt', 'claude', 'gemini', 'grok'])('preserves undelivered instructions when shutting down %s', async (provider) => {
    const h = harness(), a = await h.runtime.start(request('a', provider));
    await h.runtime.queue(update(a.task.id, 'next'));
    h.attempts[0].finish(); await h.flush();
    expect(h.attempts).toHaveLength(2);
    expect(h.runtime.snapshot()[0].queue[0].state).toBe('applying');

    h.runtime.shutdown();
    expect(h.attempts[1].stopped).toBe(1);
    h.attempts[1].emit({ type: 'delta', text: 'late shutdown output' });
    h.attempts[1].finish(); await h.flush();

    const task = h.runtime.snapshot()[0];
    expect(task.state).toBe('interrupted');
    expect(task.queue[0].state).toBe('queued');
    expect(task.messages.find((m: any) => m.id === 'next').delivery).toBe('queued');
    expect(task.messages.at(-1)).toMatchObject({ content: '', outcome: 'interrupted' });
    expect(h.attempts).toHaveLength(2);
    expect(h.outcomes).toEqual([]);
    expect((await h.runtime.start(request('after-close', provider))).code).toBe('shutting_down');
  });

  it.each(['chatgpt', 'claude', 'gemini', 'grok'])('preserves cancelled delivery when %s completes after stop without output', async (provider) => {
    const h = harness(), a = await h.runtime.start(request('a', provider));
    await h.runtime.queue(update(a.task.id, 'next'));
    h.attempts[0].finish(); await h.flush();
    expect(h.attempts).toHaveLength(2);
    expect(h.runtime.snapshot()[0].queue[0].state).toBe('applying');

    await h.runtime.stop(a.task.id);
    expect(h.attempts[1].stopped).toBe(1);
    h.attempts[1].emit({ type: 'delta', text: 'late output' });
    h.attempts[1].finish(); await h.flush();

    const task = h.runtime.snapshot()[0];
    expect(task.state).toBe('cancelled');
    expect(task.queue[0].state).toBe('cancelled');
    expect(task.messages.find((m: any) => m.id === 'next').delivery).toBe('cancelled');
    expect(task.messages.at(-1)).toMatchObject({ content: '', outcome: 'cancelled' });
    expect(h.attempts).toHaveLength(2);
    expect(h.outcomes).toEqual([]);
  });

  it('keeps concurrent chats independent and queueing does not interrupt', async () => {
    const h = harness();
    const a = await h.runtime.start(request());
    await h.runtime.start(request('b'));
    expect(h.attempts).toHaveLength(2);
    expect((await h.runtime.queue(update(a.task.id, 'change'))).ok).toBe(true);
    expect(h.attempts[0].interrupted).toBe(0);
    await h.runtime.stop(a.task.id);
    expect(h.attempts[0].stopped).toBe(1);
    expect(h.attempts[1].stopped).toBe(0);
  });

  it('applies only the captured queue after interruption settles; fences late output', async () => {
    const h = harness(), a = await h.runtime.start(request());
    h.attempts[0].emit({ type: 'delta', text: 'Partial' });
    await h.runtime.queue(update(a.task.id, 'first'));
    await h.runtime.interrupt(a.task.id);
    await h.runtime.queue(update(a.task.id, 'later'));
    expect(h.attempts).toHaveLength(1);
    h.attempts[0].finish({ kind: 'interrupted', continuation: { saved: true } });
    await h.flush();
    expect(h.attempts).toHaveLength(2);
    expect(h.attempts[1].input.updates.map((m: any) => m.content)).toEqual(['first']);
    expect(h.attempts[1].input.continuation).toEqual({ saved: true });
    h.attempts[0].emit({ type: 'delta', text: 'LATE' });
    expect(JSON.stringify(h.runtime.snapshot())).not.toContain('LATE');
    expect(h.runtime.snapshot()[0].queue.find((x: any) => x.id === 'later').state).toBe('queued');
  });

  it('continues queued instructions naturally, notifying only the final outcome', async () => {
    const h = harness(), a = await h.runtime.start(request());
    await h.runtime.queue(update(a.task.id, 'next'));
    h.attempts[0].finish(); await h.flush();
    expect(h.attempts).toHaveLength(2); expect(h.outcomes).toHaveLength(0);
    h.attempts[1].finish(); await h.flush();
    expect(h.outcomes).toHaveLength(1);
    expect(h.runtime.snapshot()[0].state).toBe('complete');
    expect((await h.runtime.queue(update(a.task.id, 'too-late'))).code).toBe('task_finished');
  });

  it('keeps accepted updates queued on uncertain interruption without replay', async () => {
    const h = harness(), a = await h.runtime.start(request());
    await h.runtime.queue(update(a.task.id, 'change')); await h.runtime.interrupt(a.task.id);
    h.attempts[0].finish({ kind: 'failed', error: 'Tool outcome unknown', uncertainEffects: true }); await h.flush();
    expect(h.attempts).toHaveLength(1);
    expect(h.runtime.snapshot()[0]).toMatchObject({ state: 'failed', queue: [{ state: 'queued' }] });
  });

  it('deduplicates submissions and updates; rejects conflicting IDs', async () => {
    const h = harness(), a = await h.runtime.start(request());
    expect((await h.runtime.start(request())).task.id).toBe(a.task.id);
    expect((await h.runtime.start({ ...request(), model: 'different' })).ok).toBe(false);
    await h.runtime.queue(update(a.task.id, 'q')); await h.runtime.queue(update(a.task.id, 'q'));
    expect(h.runtime.snapshot()[0].queue).toHaveLength(1);
    expect((await h.runtime.queue({ ...update(a.task.id, 'q'), message: { id: 'q', role: 'user', content: 'conflict' } })).ok).toBe(false);
  });

  it('bounds concurrency and skips a busy code workspace lane', async () => {
    const h = harness();
    await h.runtime.start(request('code1', 'claude', 'code'));
    await h.runtime.start(request('code2', 'claude', 'code'));
    await h.runtime.start(request('b')); await h.runtime.start(request('c')); await h.runtime.start(request('d'));
    expect(h.attempts).toHaveLength(3);
    expect(h.runtime.snapshot().find((x: any) => x.target.id === 'code2').state).toBe('queued');
    h.attempts[0].finish(); await h.flush();
    expect(h.attempts).toHaveLength(4);
    expect(h.attempts[3].input.request.conversationId).toBe('code2');
  });

  it('forgets a generation without resurrection and permits undo with a new generation', async () => {
    const h = harness(), input = request();
    await h.runtime.start(input); await h.runtime.forgetTarget(input.target);
    h.attempts[0].emit({ type: 'delta', text: 'late' }); h.attempts[0].finish(); await h.flush();
    expect(h.runtime.snapshot()).toEqual([]);
    expect((await h.runtime.start({ ...input, requestId: 'again' })).ok).toBe(false);
    expect((await h.runtime.start({ ...input, requestId: 'undo', target: { ...input.target, generation: 'new' } })).ok).toBe(true);
  });
});

it('preserves normalized history when fencing for project maintenance while normal chat deletion still purges it', async () => {
  const deleted: string[] = [];
  const runtime = createTaskCoordinator({ storage: { chats: { delete: async (id: string) => { deleted.push(id); } } },
    emit() {}, openAttempt() { throw new Error('A fenced task cannot start'); } });
  try {
    const input = request('moved');
    await runtime.forgetTarget(input.target, true);
    expect(deleted).toEqual([]);
    expect((await runtime.start(input)).ok).toBe(false);
    await runtime.forgetTarget(request('owned').target);
    expect(deleted).toEqual(['owned']);
  } finally { runtime.shutdown(); }
});
