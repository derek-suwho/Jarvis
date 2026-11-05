import { describe, expect, it, vi } from 'vitest';
import { recoverInterruptedMessages } from '../../src/lib/taskProjection';
import { createTaskClient } from '../../src/lib/tasks';
import type { TaskEvent, TaskSnapshot, TasksBridge } from '../../src/shared/tasks';

const snapshot = (revision: number): TaskSnapshot => ({ id: 'task', requestId: 'request', target: { id: 'chat', kind: 'chat', generation: 'chat:chat', ephemeral: false }, title: 'Task', modelLabel: 'Model', state: 'running', revision, createdAt: 1, updatedAt: revision, messages: [], queue: [], unread: false });
describe('task client hydration', () => {
  it('subscribes before snapshot, retaining newer events and removal tombstones', async () => {
    let emit!: (event: TaskEvent) => void;
    let resolve!: (tasks: TaskSnapshot[]) => void;
    const bridge = { onEvent: (listener: typeof emit) => { emit = listener; return vi.fn(); }, snapshot: () => new Promise<TaskSnapshot[]>((done) => { resolve = done; }) } as unknown as TasksBridge;
    const client = createTaskClient(bridge);
    const loading = client.connect();
    emit({ type: 'snapshot', task: snapshot(3) });
    resolve([snapshot(1)]);
    await loading;
    expect(client.getSnapshot()[0].revision).toBe(3);
    emit({ type: 'removed', taskId: 'task', target: snapshot(3).target, revision: 4 });
    emit({ type: 'snapshot', task: snapshot(2) });
    expect(client.getSnapshot()).toEqual([]);
  });
  it('retries a failed initial snapshot without retaining the failed subscription', async () => {
    const active = new Set<(event: TaskEvent) => void>();
    const off = vi.fn();
    const bridge = {
      onEvent: (listener: (event: TaskEvent) => void) => {
        active.add(listener);
        return () => { active.delete(listener); off(); };
      },
      snapshot: vi.fn()
        .mockRejectedValueOnce(new Error('Provider transport disconnected'))
        .mockResolvedValueOnce([snapshot(2)]),
    } as unknown as TasksBridge;
    const client = createTaskClient(bridge);
    await expect(client.connect()).rejects.toThrow('Provider transport disconnected');
    expect(off).toHaveBeenCalledOnce();
    expect(active.size).toBe(0);

    const retry = client.connect();
    expect(client.connect()).toBe(retry);
    await retry;
    expect(bridge.snapshot).toHaveBeenCalledTimes(2);
    expect(active.size).toBe(1);
    expect(client.getSnapshot()).toEqual([snapshot(2)]);
    active.forEach((emit) => emit({ type: 'snapshot', task: snapshot(3) }));
    expect(client.getSnapshot()[0].revision).toBe(3);
  });

  it('discards failed hydration events so retry can recover abandoned saved output', async () => {
    let emit!: (event: TaskEvent) => void;
    let reject!: (error: Error) => void;
    const bridge = {
      onEvent: (listener: typeof emit) => { emit = listener; return vi.fn(); },
      snapshot: vi.fn()
        .mockImplementationOnce(() => new Promise<TaskSnapshot[]>((_resolve, fail) => { reject = fail; }))
        .mockResolvedValueOnce([]),
    } as unknown as TasksBridge;
    const client = createTaskClient(bridge);
    const loading = client.connect();
    emit({ type: 'snapshot', task: snapshot(8) });
    reject(new Error('Disconnected during hydration'));
    await expect(loading).rejects.toThrow('Disconnected during hydration');
    await client.connect();
    expect(client.getSnapshot()).toEqual([]);
    const recovered = recoverInterruptedMessages([{
      id: 'chat', title: 'Saved', updatedAt: 1, messages: [{
        id: 'answer', role: 'assistant', content: 'Saved partial', taskId: 'task', attemptId: 'attempt',
      }],
    }], client.getSnapshot());
    expect(recovered[0].messages[0]).toMatchObject({ content: 'Saved partial', outcome: 'interrupted' });
    // A fresh connection may use lower revisions after a main-process restart.
    emit({ type: 'snapshot', task: snapshot(1) });
    expect(client.getSnapshot()).toEqual([snapshot(1)]);
  });

  it('ignores late events from a failed connection after retry establishes fresh ownership', async () => {
    const callbacks: ((event: TaskEvent) => void)[] = [];
    const bridge = {
      onEvent: (listener: (event: TaskEvent) => void) => { callbacks.push(listener); return vi.fn(); },
      snapshot: vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce([snapshot(1)]),
    } as unknown as TasksBridge;
    const client = createTaskClient(bridge);
    await expect(client.connect()).rejects.toThrow('Disconnected');
    await client.connect();
    const changed = vi.fn();
    client.subscribe(changed);

    // IPC callbacks already queued at unsubscribe time belong to the old connection.
    callbacks[0]({ type: 'removed', taskId: 'task', target: snapshot(1).target, revision: 99 });
    expect(client.getSnapshot()).toEqual([snapshot(1)]);
    expect(changed).not.toHaveBeenCalled();
    callbacks[1]({ type: 'snapshot', task: snapshot(2) });
    expect(client.getSnapshot()).toEqual([snapshot(2)]);
    expect(changed).toHaveBeenCalledOnce();
  });

});

it('fences forgotten generations synchronously through late hydration, events, and command receipts', async () => {
  let emit!: (event: TaskEvent) => void;
  let hydrate!: (tasks: TaskSnapshot[]) => void;
  let finish!: () => void;
  let answer!: (result: { ok: true; task: TaskSnapshot }) => void;
  const bridge = {
    onEvent: (listener: typeof emit) => { emit = listener; return vi.fn(); },
    snapshot: () => new Promise<TaskSnapshot[]>((resolve) => { hydrate = resolve; }),
    start: () => new Promise<{ ok: true; task: TaskSnapshot }>((resolve) => { answer = resolve; }),
    forgetTarget: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
  } as unknown as TasksBridge;
  const client = createTaskClient(bridge);
  const connected = client.connect();
  emit({ type: 'snapshot', task: snapshot(1) });
  const started = client.start({} as Parameters<TasksBridge['start']>[0]);
  const forgotten = client.forgetTarget(snapshot(1).target);
  expect(client.getSnapshot()).toEqual([]);
  emit({ type: 'snapshot', task: snapshot(3) });
  hydrate([snapshot(2)]);
  answer({ ok: true, task: snapshot(4) });
  await connected;
  await expect(started).resolves.toEqual({
    ok: false, code: 'target_forgotten', message: 'This conversation was deleted. Start a new chat to continue.',
  });
  expect(client.getSnapshot()).toEqual([]);
  finish();
  await forgotten;
  emit({ type: 'snapshot', task: snapshot(5) });
  expect(client.getSnapshot()).toEqual([]);
  const fresh = { ...snapshot(6), id: 'fresh', target: { ...snapshot(6).target, generation: 'new-generation' } };
  emit({ type: 'snapshot', task: fresh });
  expect(client.getSnapshot()).toEqual([fresh]);
});

it('keeps a failed deletion fenced and permits retry without hiding other targets', async () => {
  let emit!: (event: TaskEvent) => void;
  const other = { ...snapshot(1), id: 'other', target: { ...snapshot(1).target, id: 'other-chat' } };
  const bridge = {
    onEvent: (listener: typeof emit) => { emit = listener; return vi.fn(); },
    snapshot: async () => [snapshot(1), other],
    forgetTarget: vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValueOnce(undefined),
  } as unknown as TasksBridge;
  const client = createTaskClient(bridge);
  await client.connect();
  await expect(client.forgetTarget(snapshot(1).target)).rejects.toThrow('disconnected');
  emit({ type: 'snapshot', task: snapshot(2) });
  expect(client.getSnapshot()).toEqual([other]);
  await client.forgetTarget(snapshot(1).target);
  expect(bridge.forgetTarget).toHaveBeenCalledTimes(2);
  expect(client.getSnapshot()).toEqual([other]);
});
