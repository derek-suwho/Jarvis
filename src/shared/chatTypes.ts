export type Role = 'user' | 'assistant';
export type Feedback = 'up' | 'down';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Image preview derived from media bytes; not duplicated in persistent storage. */
  preview?: string;
  /** Original PDF/image bytes encoded as base64. Saved separately in IndexedDB. */
  data?: string;
  /** UTF-8 file contents supplied to provider adapters. */
  text?: string;
}

/** One tool call made while writing a reply (MCP server tool, skill, or Claude Code built-in). */
export interface ToolUse {
  id: string;
  /** Server or source shown to the user, e.g. "context7" or "Skills". */
  server: string;
  tool: string;
  /** Short argument summary, e.g. the skill being loaded. */
  detail?: string;
  status: 'running' | 'done' | 'error';
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  model?: string;
  /** A failed reply; shown but never sent back to a model as context. */
  error?: boolean;
  attachments?: Attachment[];
  feedback?: Feedback;
  /** Tool calls made for this reply, in order. */
  tools?: ToolUse[];
  taskId?: string;
  attemptId?: string;
  taskRevision?: number;
  outcome?: 'complete' | 'interrupted' | 'cancelled' | 'failed';
  delivery?: 'queued' | 'applying' | 'applied' | 'cancelled';
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  projectId?: string;
  /** Temporary chats never reach storage or the sidebar. */
  temporary?: boolean;
  /** Fences older task output after deletion and undo. */
  taskGeneration?: string;
}
