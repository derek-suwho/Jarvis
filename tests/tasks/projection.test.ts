import { describe, expect, it } from 'vitest';
import { applyTaskSnapshot, recoverInterruptedMessages } from '../../src/lib/taskProjection';
import type { TaskSnapshot } from '../../src/shared/tasks';
import type { Chat } from '../../src/lib/chats';

const task = (revision = 2): TaskSnapshot => ({
  id: 'task', requestId: 'request', target: { kind: 'chat', id: 'chat', generation: 'chat:chat', ephemeral: false },
  state: 'running', revision, title: 'Original title', modelLabel: 'Model', createdAt: 1, updatedAt: 2,
  messages: [{ id: 'answer', role: 'assistant', content: 'New output', taskId: 'task', taskRevision: revision }], queue: [], unread: false,
});
const chat = (): Chat => ({ id: 'chat', title: 'Renamed', projectId: 'moved', pinned: true, updatedAt: 1,
  messages: [{ id: 'question', role: 'user', content: 'Unrelated' }, { id: 'answer', role: 'assistant', content: 'Old', taskId: 'task', taskRevision: 1, feedback: 'up' }],
});

describe('task projections', () => {
  it('upserts once, preserving metadata and feedback', () => {
    const projected = applyTaskSnapshot([chat()], task());
    expect(applyTaskSnapshot(projected, task())).toEqual(projected);
    expect(projected[0]).toMatchObject({ title: 'Renamed', projectId: 'moved', pinned: true });
    expect(projected[0].messages).toHaveLength(2);
    expect(projected[0].messages[1]).toMatchObject({ content: 'New output', feedback: 'up' });
  });
  it('ignores old output and mismatched generations', () => {
    const current = applyTaskSnapshot([chat()], task(4));
    expect(applyTaskSnapshot(current, task(2))).toEqual(current);
    expect(applyTaskSnapshot([{ ...chat(), taskGeneration: 'restored' }], task())).toEqual([{ ...chat(), taskGeneration: 'restored' }]);
  });
  it('restores accepted new chats from creation, never creates a missing chat without it', () => {
    expect(applyTaskSnapshot([], task())).toEqual([]);
    expect(applyTaskSnapshot([], { ...task(), creation: chat() })[0].messages).toHaveLength(2);
  });
  it('marks abandoned output and queued instructions interrupted without changing live tasks', () => {
    const saved = { ...chat(), messages: [
      { id: 'a', role: 'assistant' as const, content: 'Partial', taskId: 'lost', attemptId: 'attempt' },
      { id: 'q', role: 'user' as const, content: 'Queued', taskId: 'lost', delivery: 'queued' as const },
      { id: 'live', role: 'assistant' as const, content: 'Streaming', taskId: 'task', attemptId: 'current' },
    ] };
    const recovered = recoverInterruptedMessages([saved], [task()]);
    expect(recovered[0].messages[0].outcome).toBe('interrupted');
    expect(recovered[0].messages[1].delivery).toBe('cancelled');
    expect(recovered[0].messages[2].outcome).toBeUndefined();
  });
});
