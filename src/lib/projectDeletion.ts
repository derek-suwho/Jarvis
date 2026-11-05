import type { Chat } from '../shared/chatTypes';
import type { TaskSnapshot, TaskTarget } from '../shared/tasks';
import type { Tab } from './tabs';
import { chatTarget } from './taskProjection';

/** Prepare renderer history and cancellation targets before destructive checkpoint maintenance.
 * Captured scope, rather than a chat's current project, owns moved task evidence.
 */
export function planProjectDeletion(projectId: string, chats: Chat[], tasks: TaskSnapshot[], tabs?: Tab[]): { chats: Chat[]; targets: TaskTarget[]; tabs?: Tab[] } {
  const owned = new Set(chats.filter(chat => chat.projectId === projectId).map(chat => chat.id));
  const affected = tasks.filter(task => task.project?.id === projectId ||
    (task.target.kind === 'chat' && owned.has(task.target.id)));
  const targets = new Map<string, TaskTarget>();
  const addTarget = (target: TaskTarget) => targets.set(JSON.stringify([target.kind, target.id, target.generation]), target);
  for (const chat of chats) if (owned.has(chat.id)) addTarget(chatTarget(chat));
  for (const task of affected) addTarget(task.target);
  const sourceIds = new Set([...owned, ...affected.filter(task => task.target.kind === 'chat').map(task => task.target.id)]);
  const removedTabs = new Set((tabs ?? []).filter(tab => tab.kind === 'sidechat' &&
    (tab.sidechat.sourceProjectId === projectId || sourceIds.has(tab.sidechat.sourceChatId ?? '') ||
      affected.some(task => task.target.kind === 'sidechat' && task.target.id === tab.id))).map(tab => tab.id));
  for (const id of removedTabs) addTarget({ kind: 'sidechat', id, generation: `side:${id}`, ephemeral: true });
  return {
    ...(tabs ? { tabs: tabs.filter(tab => !removedTabs.has(tab.id)) } : {}),
    targets: [...targets.values()],
    chats: chats.filter(chat => !owned.has(chat.id)).map(chat => {
      const captured = affected.filter(task => task.target.kind === 'chat' && task.target.id === chat.id);
      if (!captured.length) return chat;
      const taskIds = new Set(captured.map(task => task.id));
      const attempts = new Set(captured.map(task => task.requestId));
      const messageIds = new Set(captured.flatMap(task => task.messages.map(message => message.id)));
      return { ...chat, title: 'New chat', messages: chat.messages.filter(message =>
        !messageIds.has(message.id) && !taskIds.has(message.taskId ?? '') && !attempts.has(message.attemptId ?? '')) };
    }),
  };
}

/** The caller keeps saves paused on failure and resumes only after publishing
 * authoritative history into its committed renderer state. */
export async function executeProjectDeletion(projectId: string, chats: Chat[], tasks: TaskSnapshot[], operations: {
  pause: () => void;
  forget: (target: TaskTarget) => Promise<void>;
  projectDelete: () => Promise<void>;
  reconcile: (run: () => Promise<void>) => Promise<void>;
  load: () => Chat[];
  removeTabs: (ids: string[]) => void;
  publish: (chats: Chat[]) => void;
}, tabs?: Tab[]): Promise<void> {
  const plan = planProjectDeletion(projectId, chats, tasks, tabs);
  operations.pause();
  await Promise.all(plan.targets.map(operations.forget));
  await operations.reconcile(operations.projectDelete);
  const restored = operations.load();
  // Durable scope can outlive task snapshots and the source chat's project move.
  const remainingMessages = new Map(restored.map(chat => [chat.id, new Set(chat.messages.map(message => message.id))]));
  const removedMessages = new Map(chats.map(chat => [chat.id, new Set(chat.messages
    .filter(message => !remainingMessages.get(chat.id)?.has(message.id)).map(message => message.id))]));
  const revokedCopies = (plan.tabs ?? []).filter(tab => tab.kind === 'sidechat' &&
    tab.sidechat.sourceChatId && tab.sidechat.context.some(message =>
      removedMessages.get(tab.sidechat.sourceChatId!)?.has(message.id)));
  if (revokedCopies.length) {
    operations.removeTabs(revokedCopies.map(tab => tab.id));
    await Promise.all(revokedCopies.map(tab => operations.forget({
      kind: 'sidechat', id: tab.id, generation: `side:${tab.id}`, ephemeral: true,
    })));
  }
  const fencedChats = new Set(plan.targets.filter(target => target.kind === 'chat').map(target => target.id));
  operations.publish(restored.map(chat => fencedChats.has(chat.id)
    ? { ...chat, taskGeneration: crypto.randomUUID() } : chat));
}
