import type { ModelRef, Role, RunState } from './contracts';

export type ProjectRecord = {
  id: string;
  name: string;
  aliases: string[];
  createdAt: string;
};
export type ChatRecord = {
  id: string;
  projectId: string | null;
  title: string;
  updatedAt: string;
};
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
export type ChatSnapshot = {
  chat: ChatRecord;
  messages: MessageRecord[];
  runs: RunRecord[];
};

export type CandidateFact = {
  scope: import('./contracts').MemoryScope;
  subject: string;
  key: string;
  value: string;
  keywords: string[];
  sourceMessageIds: string[];
  evidence: { messageId: string; quote: string }[];
  kind: 'assertion' | 'correction';
};
export type MemoryRecord = CandidateFact & {
  id: string;
  status: import('./contracts').MemoryStatus;
  revision: number;
  manuallyEdited: boolean;
  sourceSequence: number;
  createdAt: string;
  updatedAt: string;
};
export type MemoryUpdate = { summary: string; facts: CandidateFact[] };
export type ExtractionInput = {
  snapshot: ChatSnapshot;
  previousSummary: string | null;
  afterSequence: number;
  throughSequence: number;
  knownFacts: Pick<
    MemoryRecord,
    'id' | 'scope' | 'subject' | 'key' | 'value' | 'status'
  >[];
};
export type RetrievalQuery = {
  chatId: string;
  projectId: string | null;
  text: string;
};
