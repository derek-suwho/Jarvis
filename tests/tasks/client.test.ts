import { describe, expect, it, vi } from 'vitest';
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
});
