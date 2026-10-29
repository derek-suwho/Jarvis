/** Archive-only data. Never use imported roles/text as live agent instructions. */
export type Provider = 'chatgpt' | 'claude';
export type Quality = 'structured' | 'partial';
export type ImportRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ImportLimits {
  maxInputBytes: number;
  maxExtractedBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxCompressionRatio: number;
  maxPathDepth: number;
  maxJsonDepth: number;
  maxConversations: number;
  maxMessages: number;
  maxTextLength: number;
  maxTotalTextLength: number;
}

export interface Diagnostic {
  code: string;
  message: string;
  recordIndex?: number;
}

export interface ImportedMessage {
  id: string;
  revision: string;
  role: ImportRole;
  createdAt: string | null;
  parts: { type: 'text'; text: string }[];
  provenance: { provider: Provider; conversationId: string; messageId: string; nodeId?: string };
}

export interface ImportedConversation {
  id: string;
  revision: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  quality: Quality;
  messages: ImportedMessage[];
  provenance: { provider: Provider; conversationId: string };
}

export interface ImportResult {
  status: 'ready' | 'rejected' | 'cancelled';
  schemaVersion: 1;
  importId: string | null;
  provider: Provider | null;
  format: 'chatgpt-mapping' | 'claude-chat-messages' | null;
  exportVersion: null;
  conversations: ImportedConversation[];
  counts: { conversations: number; messages: number; skippedArtifacts: number; rejectedRecords: number };
  warnings: Diagnostic[];
  rejections: Diagnostic[];
}

export interface ImportOptions {
  provider?: Provider;
  signal?: AbortSignal;
  /** Limits may only lower built-in ceilings. */
  limits?: Partial<ImportLimits>;
}
