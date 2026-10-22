import type { ModelRef, Role, RunState } from './contracts';

export type ProjectRecord = { id: string; name: string; aliases: string[]; createdAt: string };
export type ChatRecord = { id: string; projectId: string | null; title: string; updatedAt: string };
export type MessageRecord = {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  sourceSequence: number | null;
  createdAt: string;
  runId: string | null;
};
export type RunRecord = {
  id: string;
  chatId: string;
  requestId: string;
  userMessageId: string;
  assistantMessageId: string;
  model: ModelRef;
  state: RunState;
  error: string | null;
};
export type ChatSnapshot = { chat: ChatRecord; messages: MessageRecord[]; runs: RunRecord[] };
