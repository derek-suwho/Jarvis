import type { Chat, Message } from './chats';
import type { TaskSnapshot, TaskTarget } from '../shared/tasks';
import { isActiveTask } from '../shared/tasks';

export function chatTarget(chat: Pick<Chat, 'id' | 'temporary' | 'taskGeneration'>): TaskTarget {
  return { kind: 'chat', id: chat.id, generation: chat.taskGeneration ?? `chat:${chat.id}`, ephemeral: !!chat.temporary };
}

export function mergeTaskMessages(messages: Message[], task: TaskSnapshot): Message[] {
  const updates = new Map(task.messages.map((message) => [message.id, message]));
  const merged = messages.map((message) => {
    const update = updates.get(message.id);
    updates.delete(message.id);
    if (!update || (message.taskRevision ?? 0) > task.revision) return message;
    return { ...message, ...update, taskId: task.id, taskRevision: task.revision,
      ...(message.feedback ? { feedback: message.feedback } : {}) };
  });
  for (const message of updates.values()) merged.push({ ...message, taskId: task.id, taskRevision: task.revision });
  return merged;
}

/** Main owns only its message IDs. User-managed chat metadata remains authoritative here. */
export function applyTaskSnapshot(chats: Chat[], task: TaskSnapshot): Chat[] {
  if (task.target.kind !== 'chat') return chats;
  let current = chats.find((chat) => chat.id === task.target.id);
  if (!current && task.creation) current = { ...task.creation, taskGeneration: task.target.generation };
  if (!current || chatTarget(current).generation !== task.target.generation) return chats;
  const updated = { ...current, messages: mergeTaskMessages(current.messages, task), updatedAt: Math.max(current.updatedAt, task.updatedAt) };
  return chats.some((chat) => chat.id === current!.id)
    ? chats.map((chat) => chat.id === updated.id ? updated : chat)
    : [updated, ...chats];
}

export function recoverInterruptedMessages(chats: Chat[], tasks: TaskSnapshot[]): Chat[] {
  const active = new Set(tasks.filter(isActiveTask).map((task) => task.id));
  return chats.map((chat) => ({ ...chat, messages: chat.messages.map((message) => {
    if (!message.taskId || active.has(message.taskId)) return message;
    const partial = message.role === 'assistant' && message.attemptId && !message.outcome;
    const queued = message.delivery === 'queued' || message.delivery === 'applying';
    return partial || queued ? { ...message,
      ...(partial ? { outcome: 'interrupted' as const } : {}),
      ...(queued ? { delivery: 'cancelled' as const } : {}),
      ...(message.tools ? { tools: message.tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'error' as const } : tool) } : {}),
    } : message;
  }) }));
}
