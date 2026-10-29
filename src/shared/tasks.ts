import type { Chat, Message } from './chatTypes';

export type TaskTarget = { kind: 'chat' | 'sidechat'; id: string; generation: string; ephemeral: boolean };
export type TaskState = 'queued' | 'running' | 'interrupting' | 'stopping' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
export type QueueEntry = { id: string; message: Message; sequence: number; state: 'queued' | 'applying' | 'applied' | 'cancelled' };
export interface TaskRequest {
  requestId: string;
  target: TaskTarget;
  title: string;
  history: Message[];
  input: Message;
  instructions: string;
  modelLabel: string;
  provider: 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'preview';
  model: string;
  mode?: 'chat' | 'code';
  reasoning?: string;
  creation?: Chat;
  retryOf?: string;
}
export interface TaskSnapshot {
  id: string;
  requestId: string;
  target: TaskTarget;
  state: TaskState;
  revision: number;
  createdAt: number;
  updatedAt: number;
  title: string;
  modelLabel: string;
  messages: Message[];
  queue: QueueEntry[];
  unread: boolean;
  error?: string;
  creation?: Chat;
  retryOf?: string;
}
export type TaskEvent = { type: 'snapshot'; task: TaskSnapshot } |
  { type: 'removed'; taskId: string; target: TaskTarget; revision: number };
export type TaskResult = { ok: true; task: TaskSnapshot } | { ok: false; code: string; message: string };
export interface TasksBridge {
  start(input: TaskRequest): Promise<TaskResult>;
  queue(input: { taskId: string; entryId: string; message: Message }): Promise<TaskResult>;
  removeQueued(input: { taskId: string; entryId: string }): Promise<TaskResult>;
  interrupt(taskId: string): Promise<TaskResult>;
  stop(taskId: string): Promise<TaskResult>;
  snapshot(): Promise<TaskSnapshot[]>;
  ack(input: { taskId: string; revision: number }): Promise<void>;
  forgetTarget(target: TaskTarget): Promise<void>;
  detach(taskIds: string[]): Promise<void>;
  markRead(taskId: string): Promise<void>;
  setVisibleTargets(targets: TaskTarget[]): Promise<void>;
  setPreferences(prefs: { desktopTaskNotifications: boolean }): Promise<void>;
  ready(): Promise<void>;
  onEvent(listener: (event: TaskEvent) => void): () => void;
  onOpenTarget(listener: (target: TaskTarget) => void): () => void;
}
export const isActiveTask = (task: TaskSnapshot): boolean =>
  ['queued', 'running', 'interrupting', 'stopping'].includes(task.state);
