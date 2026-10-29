import type { Diagnostic, HistoryMemoryPolicy } from './types';

/** Descriptor vocabulary only: these names do not claim local discovery/adapter support. */
export type AgentSetupSource = 'claude-code' | 'claude-cowork' | 'codex';
export type SetupCategory = 'instructions' | 'skill' | 'plugin' | 'mcp-server' | 'project' | 'project-memory' | 'hook';
export type SetupScope = { kind: 'user' } | { kind: 'project'; projectId: string };

/** Adapter-supplied metadata only; never raw settings, text, commands, secrets, or paths. */
export interface SetupAssetDescriptor {
  source: AgentSetupSource;
  sourceId: string;
  category: SetupCategory;
  scope: SetupScope;
  /** SHA-256 of a future adapter's reviewed, credential-free normalized asset. */
  contentDigest: string;
}

interface SetupItemBase {
  id: string;
  revision: string;
  source: AgentSetupSource;
  /** Project IDs here are hashed references, never raw local paths or names. */
  scope: SetupScope;
  selected: boolean;
  enabled: false;
}

/** Selection never constitutes review, installation, activation, or execution. */
export type SetupPlanItem = SetupItemBase & (
  | { category: 'hook'; activation: 'disabled'; memoryUse: 'none' }
  | { category: 'plugin' | 'mcp-server'; activation: 'requires-explicit-review'; memoryUse: 'none' }
  | { category: 'project-memory'; activation: 'not-activated'; memoryUse: 'project-reference-only' }
  | { category: 'instructions' | 'skill' | 'project'; activation: 'not-activated'; memoryUse: 'none' }
);

/** Binding selection to a revision prevents silently selecting a changed asset. */
export interface SetupSelection { id: string; revision: string }

export interface SetupSelectionPlan {
  mode: 'agent-setup';
  phase: 'selection-plan';
  schemaVersion: 1;
  status: 'ready' | 'rejected';
  credentials: 'excluded';
  memoryPolicy: HistoryMemoryPolicy;
  items: SetupPlanItem[];
  rejections: Diagnostic[];
}
