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
      let resolve: any;
      const item = { input, emit, interrupted: 0, stopped: 0, finish: (result: any = { kind: 'complete', continuation: {} }) => resolve(result) };
      attempts.push(item);
      return { settled: new Promise((r) => { resolve = r; }), interrupt: () => { item.interrupted++; }, stop: () => { item.stopped++; } };
    },
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { runtime, attempts, events, outcomes, flush };
}
const update = (taskId: string, id: string) => ({ taskId, entryId: id, message: { id, role: 'user', content: id } });

describe('main task coordinator', () => {
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
