import type { Message } from './chats';
import { mockReply, newId, streamChunks } from './chats';
import { buildReplyHistory } from './replyContext';
import { streamLive } from './providerClient';
import type { LiveReply } from './providerClient';
import type { TaskEvent, TaskRequest, TaskResult, TaskSnapshot, TaskTarget, TasksBridge } from '../shared/tasks';
import { isActiveTask } from '../shared/tasks';

type Record = { request: TaskRequest; task: TaskSnapshot; abort?: () => void; attempt?: string };
const fail = (code: string, message: string): TaskResult => ({ ok: false, code, message });
const sameTarget = (a: TaskTarget, b: TaskTarget) => a.kind === b.kind && a.id === b.id && a.generation === b.generation;

/** Browser preview and old test transports. Desktop execution always uses the main coordinator. */
export function createPreviewTasksBridge(): TasksBridge {
  const records = new Map<string, Record>();
  const listeners = new Set<(event: TaskEvent) => void>();
  let visible: TaskTarget[] = [];
  const publish = (record: Record) => {
    record.task = { ...record.task, revision: record.task.revision + 1, updatedAt: Date.now(),
      messages: record.task.messages.map((message) => ({ ...message, taskRevision: record.task.revision + 1 })) };
    for (const listener of listeners) listener({ type: 'snapshot', task: record.task });
  };
  const result = (record: Record): TaskResult => ({ ok: true, task: record.task });
  const context = (record: Record, extra: Message[] = []) => [
    ...record.request.history,
    ...record.task.messages.map((message) => message.delivery === 'queued' ? { ...message, delivery: 'applied' as const } : message),
    ...extra,
  ];
  const settleTools = (message: Message) => message.tools?.map((tool) => tool.status === 'running' ? { ...tool, status: 'error' as const } : tool);
  const terminal = (record: Record, state: 'complete' | 'cancelled' | 'failed', error?: string) => {
    record.attempt = undefined;
    record.abort = undefined;
    record.task = { ...record.task, state, error,
      unread: state !== 'cancelled' && (!document.hasFocus() || !visible.some((target) => sameTarget(target, record.task.target))),
      messages: record.task.messages.map((message) => message.role === 'assistant' && !message.outcome ? { ...message, outcome: state, tools: settleTools(message) } : message) };
    publish(record);
    schedule();
  };
  const run = (record: Record) => {
    const attempt = newId();
    record.attempt = attempt;
    const queued = record.task.queue.filter((entry) => entry.state === 'queued');
    const ids = new Set(queued.map((entry) => entry.message.id));
    record.task = { ...record.task, state: 'running',
      queue: record.task.queue.map((entry) => ids.has(entry.message.id) ? { ...entry, state: 'applied' } : entry),
      messages: record.task.messages.map((message) => ids.has(message.id) ? { ...message, delivery: 'applied' } : message) };
    publish(record);
    const current = () => record.attempt === attempt && isActiveTask(record.task);
    const finish = () => {
      if (!current()) return;
      record.abort = undefined;
      record.task = { ...record.task, messages: record.task.messages.map((message) => message.attemptId === attempt ? { ...message, outcome: 'complete' } : message) };
      if (record.task.queue.some((entry) => entry.state === 'queued')) {
        record.attempt = undefined;
        record.task = { ...record.task, state: 'queued' };
        publish(record);
        schedule();
      } else terminal(record, 'complete');
    };
    const append = (message: Message) => {
      if (!current()) return;
      record.task = { ...record.task, messages: [...record.task.messages, { ...message, taskId: record.task.id, attemptId: attempt }] };
      publish(record);
      if (message.error) terminal(record, 'failed', message.content);
    };
    const update = (id: string, patch: Partial<Message>) => {
      if (!current()) return;
      record.task = { ...record.task, messages: record.task.messages.map((message) => message.id === id ? { ...message, ...patch } : message) };
      publish(record);
    };
    const request = record.request;
    if (request.provider !== 'preview') {
      const history = context(record);
      const live: LiveReply = request.provider === 'claude' ? {
        provider: 'claude', slug: request.model, history, instructions: request.instructions,
        mode: request.mode ?? 'chat', reasoning: request.reasoning ?? 'default', conversationId: request.target.id,
      } : { provider: request.provider, slug: request.model, history, instructions: request.instructions };
      let failed = false;
      record.abort = streamLive(live, { label: request.modelLabel,
        append: (message) => { if (message.error) failed = true; append(message); }, update,
        onSettled: () => queueMicrotask(() => { if (!failed) finish(); }),
      });
      return;
    }
    const last = record.task.messages.filter((message) => message.role === 'user' && message.delivery === 'applied').at(-1) ?? request.input;
    const chunks = streamChunks(mockReply(last.content, request.modelLabel, last.attachments));
    const id = newId();
    let index = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
      if (!current()) return;
      append({ id, role: 'assistant', content: '', model: request.modelLabel });
      timer = setInterval(() => {
        if (!current()) return;
        update(id, { content: chunks.slice(0, ++index).join('') });
        if (index >= chunks.length) { clearInterval(timer); finish(); }
      }, 35);
    }, 450);
    record.abort = () => { clearTimeout(delay); clearInterval(timer); };
  };
  function schedule() {
    let active = [...records.values()].filter((record) => record.attempt).length;
    for (const record of records.values()) {
      if (active >= 3) break;
      if (record.task.state === 'queued' && !record.attempt) { active++; run(record); }
    }
  }
  const bridge: TasksBridge = {
    async start(request) {
      const old = [...records.values()].find((record) => record.request.requestId === request.requestId);
      if (old) return JSON.stringify(old.request) === JSON.stringify(request) ? result(old) : fail('conflict', 'This message ID was already used.');
      if ([...records.values()].some((record) => sameTarget(record.task.target, request.target) && isActiveTask(record.task))) return fail('active_task', 'This conversation already has a task. Queue your message instead.');
      try { buildReplyHistory([...request.history, request.input], request.instructions); } catch (error) { return fail('invalid_request', (error as Error).message); }
      if ([...records.values()].filter((record) => record.task.state === 'queued').length >= 20) return fail('queue_full', 'The task queue is full. Wait for a task to finish.');
      const id = newId();
      const record: Record = { request: structuredClone(request), task: {
        id, requestId: request.requestId, target: request.target, title: request.title, modelLabel: request.modelLabel,
        state: 'queued', revision: 0, createdAt: Date.now(), updatedAt: Date.now(), unread: false, queue: [], creation: request.creation,
        messages: [{ ...request.input, taskId: id, delivery: 'applied' }],
      } };
      records.set(id, record); publish(record);
      queueMicrotask(schedule);
      return result(record);
    },
    async queue({ taskId, entryId, message }) {
      const record = records.get(taskId);
      if (!record || !isActiveTask(record.task) || record.task.state === 'stopping') return fail('task_finished', 'This task finished. Send your message as a new turn.');
      const existing = record.task.queue.find((entry) => entry.id === entryId);
      if (existing) return existing.message.id === message.id && existing.message.content === message.content ? result(record) : fail('conflict', 'This update ID was already used.');
      if (record.task.queue.filter((entry) => entry.state === 'queued').length >= 20) return fail('queue_full', 'Up to 20 messages can wait for a task.');
      try { buildReplyHistory(context(record, [message]), record.request.instructions); } catch (error) { return fail('invalid_request', (error as Error).message); }
      const accepted = { ...message, taskId, delivery: 'queued' as const };
      record.task = { ...record.task, messages: [...record.task.messages, accepted], queue: [...record.task.queue, { id: entryId, message: accepted, sequence: record.task.queue.length, state: 'queued' }] };
      publish(record); return result(record);
    },
    async removeQueued({ taskId, entryId }) {
      const record = records.get(taskId);
      const entry = record?.task.queue.find((item) => item.id === entryId);
      if (!record || !entry || entry.state !== 'queued') return fail('already_applying', 'This message is already being applied.');
      record.task = { ...record.task, queue: record.task.queue.filter((item) => item.id !== entryId), messages: record.task.messages.filter((message) => message.id !== entry.message.id) };
      publish(record); return result(record);
    },
    async interrupt(id) {
      const record = records.get(id);
      if (!record || !isActiveTask(record.task)) return fail('task_finished', 'This task has finished.');
      if (!record.task.queue.some((entry) => entry.state === 'queued')) return fail('empty_queue', 'Queue a message first.');
      if (record.request.provider !== 'preview') return fail('unsupported', 'Applying updates requires the current Jarvis desktop app. Your messages remain queued.');
      const attempt = record.attempt;
      record.attempt = undefined;
      record.abort?.();
      record.abort = undefined;
      record.task = { ...record.task, state: 'queued', messages: record.task.messages.map((message) => message.attemptId === attempt ? { ...message, outcome: 'interrupted', tools: settleTools(message) } : message) };
      publish(record); queueMicrotask(schedule); return result(record);
    },
    async stop(id) {
      const record = records.get(id);
      if (!record) return fail('not_found', 'This task is no longer available.');
      if (!isActiveTask(record.task)) return result(record);
      record.attempt = undefined;
      record.abort?.();
      record.task = { ...record.task, queue: record.task.queue.map((entry) => entry.state === 'queued' ? { ...entry, state: 'cancelled' } : entry),
        messages: record.task.messages.map((message) => message.delivery === 'queued' ? { ...message, delivery: 'cancelled' } : message) };
      terminal(record, 'cancelled'); return result(record);
    },
    async snapshot() { return [...records.values()].map((record) => record.task); },
    async ack() {},
    async forgetTarget(target) {
      for (const record of [...records.values()]) {
        if (!sameTarget(record.task.target, target)) continue;
        record.attempt = undefined; record.abort?.(); records.delete(record.task.id);
        for (const listener of listeners) listener({ type: 'removed', taskId: record.task.id, target, revision: record.task.revision + 1 });
      }
      schedule();
    },
    async detach(ids) {
      for (const id of ids) {
        const record = records.get(id);
        if (!record || isActiveTask(record.task)) continue;
        records.delete(id);
        for (const listener of listeners) listener({ type: 'removed', taskId: id, target: record.task.target, revision: record.task.revision + 1 });
      }
    },
    async markRead(id) { const record = records.get(id); if (record?.task.unread) { record.task = { ...record.task, unread: false }; publish(record); } },
    async setVisibleTargets(targets) { visible = targets; },
    async setPreferences() {}, async ready() {},
    onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onOpenTarget() { return () => {}; },
  };
  return bridge;
}
