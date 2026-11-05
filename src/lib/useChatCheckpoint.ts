import { useEffect, useRef } from 'react';
import type { Attachment, Chat } from '../shared/chatTypes';
import { isActiveTask, type TaskSnapshot, type TasksBridge } from '../shared/tasks';
import { saveChats } from './chats';

export function useChatCheckpoint(chats: Chat[], tasks: TaskSnapshot[], tasksReady: boolean, checkpointPaused: boolean, taskClient: { bridge: TasksBridge }, checkpointPause: { current: boolean }) {
  const attachments = useRef({ previous: new Map<string, { value: Attachment; id: number }>(), next: 0 });
  const persistence = useRef<{ chats: Chat[]; tasks: TaskSnapshot[]; signature: string }>({ chats, tasks, signature: '' });
  persistence.current.chats = chats;
  persistence.current.tasks = tasks;
  useEffect(() => {
    checkpointPause.current = checkpointPaused;
    if (!tasksReady || checkpointPaused) return;
    const state = persistence.current;
    // Compare payload strings directly rather than JSON-encoding media on every
    // token. IPC snapshots may recreate equivalent attachment objects. Retain
    // only this render's attachments so removed private media can be collected.
    const current = new Map<string, { value: Attachment; id: number }>();
    const attachmentId = (key: string, value: Attachment) => {
      const previous = attachments.current.previous.get(key);
      const fields = ['id', 'name', 'type', 'size', 'data', 'preview', 'text'] as const;
      const id = previous && fields.every(field => previous.value[field] === value[field])
        ? previous.id : ++attachments.current.next;
      current.set(key, { value, id });
      return id;
    };
    // Match saveChats' retention boundary: temporary activity must not rewrite
    // durable history, while entering or leaving that history must invalidate it.
    const signature = JSON.stringify([chats.filter((chat) => !chat.temporary).map((chat) => [chat.id, chat.title, chat.projectId, chat.pinned, chat.archived, chat.taskGeneration,
      chat.messages.map((message) => {
        const active = message.role !== 'user' && tasks.some((task) => isActiveTask(task) && task.target.id === chat.id && task.messages.some((live) => live.id === message.id));
        return [message.id, message.model, active ? '' : message.content, message.delivery, message.outcome, message.feedback, message.error,
          message.taskId, message.attemptId, active ? undefined : message.taskRevision,
          active ? undefined : message.tools,
          message.attachments?.map((attachment, index) => attachmentId(JSON.stringify([chat.id, message.id, index]), attachment))];
      })]),
      tasks.filter((task) => !isActiveTask(task) && !task.target.ephemeral).map((task) => [task.id, task.state, task.revision])]);
    attachments.current.previous = current;
    const immediate = signature !== state.signature;
    state.signature = signature;
    const flush = () => {
      if (checkpointPause.current) return;
      const savedChats = state.chats;
      const savedTasks = state.tasks.filter((task) => !task.target.ephemeral && task.messages.length > 0 &&
        task.messages.every((message) => savedChats.find((chat) => chat.id === task.target.id)?.messages.some((saved) => saved.id === message.id && (saved.taskRevision ?? 0) >= task.revision)));
      void saveChats(savedChats).then(() => Promise.all(savedTasks.map((task) => taskClient.bridge.ack({ taskId: task.id, revision: task.revision })))).catch(() => {
        // A failed receipt must not suppress the next render's retry. Do not
        // invalidate a newer checkpoint accepted while this write was pending.
        if (state.signature === signature) state.signature = '';
      });
    };
    // Active output is persisted by the task backend. Copy it into the renderer
    // archive at terminal boundaries, rather than rewriting all media per token.
    if (immediate) flush();
  }, [chats, tasks, tasksReady, taskClient, checkpointPaused]);
  return persistence;
}
