import { expect, it } from 'vitest';
import { planProjectDeletion } from '../../src/lib/projectDeletion';
import type { Chat } from '../../src/shared/chatTypes';
import type { TaskSnapshot } from '../../src/shared/tasks';

it('removes owned chats and captured moved-chat evidence, fencing only affected generations', () => {
  const task = (id: string, chatId: string, projectId: string): TaskSnapshot => ({
    id, requestId: `${id}-attempt`, target: { kind: 'chat', id: chatId, generation: `chat:${chatId}`, ephemeral: false },
    project: { id: projectId, name: projectId }, state: 'complete', revision: 1,
    title: 'Private title', modelLabel: 'Model', createdAt: 1, updatedAt: 2,
    messages: [{ id: `${id}-user`, role: 'user', content: 'Private input' }], queue: [], unread: false,
  });
  const owned: Chat = { id: 'owned', projectId: 'deleted', title: 'Owned', updatedAt: 1, messages: [] };
  const moved: Chat = { id: 'moved', projectId: 'kept', title: 'Private derived title', pinned: true, updatedAt: 2, messages: [
    { id: 'old-user', role: 'user', content: 'Private input' },
    { id: 'reply', role: 'assistant', content: 'Private reply', attemptId: 'old-attempt' },
    { id: 'queued', role: 'user', content: 'Private queued instruction', taskId: 'old' },
    { id: 'safe', role: 'user', content: 'Keep this' },
  ] };
  const unrelated: Chat = { id: 'other', title: 'Other', updatedAt: 3, messages: [] };
  const tasks = [task('owned-task', 'owned', 'kept'), task('old', 'moved', 'deleted'), task('safe-task', 'other', 'kept')];
  const original = structuredClone({ chats: [owned, moved, unrelated], tasks });
  const plan = planProjectDeletion('deleted', original.chats, tasks);
  expect(plan.chats).toEqual([{ ...moved, title: 'New chat', messages: [moved.messages[3]] }, unrelated]);
  expect(plan.targets).toEqual([tasks[0].target, tasks[1].target]);
  expect({ chats: original.chats, tasks }).toEqual(original);
  expect(planProjectDeletion('absent', original.chats, tasks)).toEqual({ chats: original.chats, targets: [] });
});

it('fences all targets before awaiting cancellation and publishes only reconciled history after durable deletion', async () => {
  const { executeProjectDeletion } = await import('../../src/lib/projectDeletion');
  const owned: Chat = { id: 'owned', projectId: 'deleted', title: 'Private', updatedAt: 1, messages: [] };
  const moved: Chat = { id: 'moved', title: 'Old private title', updatedAt: 1, messages: [] };
  const calls: string[] = [];
  let release!: () => void;
  const cancellation = new Promise<void>(resolve => { release = resolve; });
  const deletion = executeProjectDeletion('deleted', [owned, moved], [], {
    removeTabs: () => {},
    pause: () => { calls.push('pause'); },
    forget: target => { calls.push(`fence:${target.id}`); return cancellation; },
    projectDelete: async () => { calls.push('delete'); },
    reconcile: async run => { calls.push('barrier'); await run(); calls.push('reload'); },
    load: () => [{ ...moved, title: 'New chat' }],
    publish: chats => { calls.push(`publish:${chats[0].title}`); },
  });
  expect(calls).toEqual(['pause', 'fence:owned']);
  release();
  await deletion;
  expect(calls).toEqual(['pause', 'fence:owned', 'barrier', 'delete', 'reload', 'publish:New chat']);
});

it('gives surviving moved chats a fresh generation after their old tasks are fenced', async () => {
  const { executeProjectDeletion } = await import('../../src/lib/projectDeletion');
  const moved: Chat = { id: 'moved', taskGeneration: 'old', title: 'New chat', updatedAt: 1, messages: [] };
  const task = { id: 't', requestId: 'r', project: { id: 'deleted', name: 'Deleted' },
    target: { kind: 'chat', id: 'moved', generation: 'old', ephemeral: false }, messages: [] } as unknown as TaskSnapshot;
  let published: Chat[] = [];
  await executeProjectDeletion('deleted', [moved], [task], {
    removeTabs: () => {},
    pause() {}, forget: async () => {}, projectDelete: async () => {},
    reconcile: async run => { await run(); }, load: () => [moved], publish: chats => { published = chats; },
  });
  expect(published[0].taskGeneration).toBeTruthy();
  expect(published[0].taskGeneration).not.toBe('old');
  expect(moved.taskGeneration).toBe('old');
});


it('fences idle side-chat copies of deleted project context while preserving unrelated tabs', async () => {
  const { createSideChat, createBrowserTab } = await import('../../src/lib/tabs');
  const source: Chat = { id: 'source', projectId: 'deleted', title: 'Secret', updatedAt: 1, messages: [] };
  const copied = createSideChat(source, 'Private instructions');
  const unrelated = createSideChat({ ...source, id: 'other', projectId: 'kept' });
  const browser = createBrowserTab();
  // The source has since moved: captured scope must still revoke the copy.
  const plan = planProjectDeletion('deleted', [{ ...source, projectId: 'kept' }], [], [copied, unrelated, browser]);
  expect(plan.targets).toEqual([{ kind: 'sidechat', id: copied.id, generation: `side:${copied.id}`, ephemeral: true }]);
  expect(plan.tabs).toEqual([unrelated, browser]);
  const { executeProjectDeletion } = await import('../../src/lib/projectDeletion');
  const calls: string[] = [];
  await executeProjectDeletion('deleted', [], [], {
    removeTabs: () => {},
    pause: () => { calls.push('pause'); },
    forget: async target => { calls.push(`fence:${target.id}`); },
    projectDelete: async () => { calls.push('delete'); },
    reconcile: async run => { await run(); }, load: () => [], publish: () => { calls.push('publish'); },
  }, [copied, unrelated, browser]);
  expect(calls).toEqual(['pause', `fence:${copied.id}`, 'delete', 'publish']);
});

it('revokes side-chat copies of evidence removed by authoritative reload without a task snapshot', async () => {
  const { executeProjectDeletion } = await import('../../src/lib/projectDeletion');
  const { createSideChat } = await import('../../src/lib/tabs');
  const secret = { id: 'old-project-message', role: 'user' as const, content: 'Private evidence' };
  const safe = { id: 'safe-message', role: 'user' as const, content: 'Keep this' };
  const moved: Chat = { id: 'moved', projectId: 'kept', title: 'Moved', updatedAt: 1, messages: [secret, safe] };
  const copied = createSideChat(moved);
  const unrelated = createSideChat({ ...moved, id: 'other', messages: [safe] });
  const calls: string[] = [];
  await executeProjectDeletion('deleted', [moved], [], {
    pause: () => { calls.push('pause'); },
    forget: async target => { calls.push(`fence:${target.id}`); },
    projectDelete: async () => { calls.push('delete'); },
    reconcile: async run => { await run(); },
    load: () => [{ ...moved, messages: [safe] }],
    removeTabs: ids => { expect(ids).toEqual([copied.id]); calls.push('close'); },
    publish: () => { calls.push('publish'); },
  }, [copied, unrelated]);
  expect(calls).toEqual(['pause', 'delete', 'close', `fence:${copied.id}`, 'publish']);
});
