export type ProviderId = 'chatgpt' | 'claude' | 'grok' | 'gemini';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'limited' | 'unavailable';
export type RunState = 'queued' | 'streaming' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
export type MemoryScope = { kind: 'global' } | { kind: 'project'; projectId: string | null };
export type MemoryStatus = 'active' | 'superseded' | 'conflicted' | 'deleted';
export type Role = 'user' | 'assistant';
export type ModelRef = { providerId: ProviderId; modelId: string };
export type ModelDescriptor = ModelRef & {
  label: string;
  inputBudgetTokens: number;
  reasoningLevels: string[];
  supportsTextOnly: boolean;
};
export type TurnInput = { requestId: string; chatId: string; text: string; model: ModelRef; reasoning?: string };
export type RunEvent =
  | { type: 'delta'; runId: string; text: string }
  | { type: 'state'; runId: string; state: RunState; error?: string }
  | { type: 'context'; runId: string; memoryIds: string[]; updating: boolean };
export type ContextBundle = {
  instructions: string;
  messages: { role: Role; content: string }[];
  memoryIds: string[];
  updating: boolean;
};
export type ImportResult = { imported: number; skipped: number; rejected: number };
