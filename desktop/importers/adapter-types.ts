import type { ImportRole, Quality } from './types';

export interface ParsedMessage {
  sourceId: string;
  nodeId?: string;
  role: ImportRole;
  createdAt: string | null;
  parts: string[];
}

/** Internal adapter result; identity hashing happens only at the public boundary. */
export interface ParsedConversation {
  sourceId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  quality: Quality;
  messages: ParsedMessage[];
  warnings: string[];
  skippedArtifacts: number;
}
