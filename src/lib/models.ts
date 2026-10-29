export const REASONING_LEVELS = ['None', 'Low', 'Medium', 'High', 'Extra High', 'Max'] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];

export const CONTEXT_SIZES = ['128K', '272K', '1M'] as const;
export type ContextSize = (typeof CONTEXT_SIZES)[number];

export interface ModelInfo {
  id: string;
  name: string;
  group: string;
  defaultReasoning: Reasoning;
  isNew?: boolean;
}

export const AUTO_MODEL_ID = 'auto';

/** Site whose favicon represents each provider group. */
export const GROUP_SITES: Record<string, string> = {
  OpenAI: 'chatgpt.com',
  Anthropic: 'claude.ai',
  Google: 'gemini.google.com',
  xAI: 'grok.com',
};

// Placeholder catalog until provider adapters report their real model lists.
export const MODEL_CATALOG: ModelInfo[] = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', group: 'OpenAI', defaultReasoning: 'Medium' },
  // Claude ids are the model names Claude Code accepts with --model.
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', group: 'Anthropic', defaultReasoning: 'High' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', group: 'Anthropic', defaultReasoning: 'Medium' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', group: 'Anthropic', defaultReasoning: 'Medium' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', group: 'Anthropic', defaultReasoning: 'Low' },
  // The official clients select the model available to the signed-in account.
  { id: 'gemini-default', name: 'Gemini', group: 'Google', defaultReasoning: 'None' },
  { id: 'grok-default', name: 'Grok', group: 'xAI', defaultReasoning: 'None' },
];

export interface ModelSettings {
  modelId: string;
  reasoning: Reasoning;
  context: ContextSize;
  fast: boolean;
  /** Claude only: plain chat, or Claude Code's own coding behavior. */
  claudeMode: ClaudeMode;
}

export const CLAUDE_MODES = [
  { id: 'chat', label: 'Chat', hint: 'Regular Claude: Jarvis system prompt, no file access' },
  { id: 'code', label: 'Code', hint: 'Runs your Claude Code with its own coding setup' },
] as const;
export type ClaudeMode = (typeof CLAUDE_MODES)[number]['id'];

export const isClaudeModel = (id: string): boolean => findModel(id)?.group === 'Anthropic';

export const DEFAULT_SETTINGS: ModelSettings = {
  modelId: 'gpt-5.6-sol',
  reasoning: 'Medium',
  context: '272K',
  fast: false,
  claudeMode: 'chat',
};

let liveOpenAI: ModelInfo[] | null = null;

/** Swaps the placeholder OpenAI models for the signed-in ChatGPT account's real list (null restores them). */
export function setLiveOpenAIModels(models: { slug: string; name: string }[] | null): void {
  liveOpenAI = models?.length
    ? models.map((m) => ({ id: m.slug, name: m.name, group: 'OpenAI', defaultReasoning: 'Medium' as Reasoning }))
    : null;
}

export function getCatalog(): ModelInfo[] {
  return liveOpenAI ? [...liveOpenAI, ...MODEL_CATALOG.filter((m) => m.group !== 'OpenAI')] : MODEL_CATALOG;
}

let availableGroups: Set<string> | null = null;

/** Limits the picker to the provider groups the user has added (null lists every group). */
export function setAvailableGroups(groups: string[] | null): void {
  availableGroups = groups ? new Set(groups) : null;
}

export const findModel = (id: string): ModelInfo | undefined => getCatalog().find((m) => m.id === id);

export function modelName(id: string): string {
  if (id === AUTO_MODEL_ID) return 'Auto';
  return findModel(id)?.name ?? id;
}

/** Trigger text: name plus muted detail, e.g. "GPT-5.6 Sol" + "Medium Fast". */
export function modelLabel(s: ModelSettings): { name: string; detail: string } {
  if (s.modelId === AUTO_MODEL_ID) return { name: 'Auto', detail: s.fast ? 'Fast' : '' };
  if (s.modelId === 'gemini-default' || s.modelId === 'grok-default') return { name: modelName(s.modelId), detail: '' };
  const mode = isClaudeModel(s.modelId) && s.claudeMode === 'code' ? 'Code' : '';
  return { name: modelName(s.modelId), detail: [s.reasoning, mode, s.fast ? 'Fast' : ''].filter(Boolean).join(' ') };
}

/** Groups matching models from added providers in catalog order, dropping empty groups. */
export function groupModels(query: string): { group: string; models: ModelInfo[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { group: string; models: ModelInfo[] }[] = [];
  for (const m of getCatalog()) {
    if (availableGroups && !availableGroups.has(m.group)) continue;
    if (q && !m.name.toLowerCase().includes(q)) continue;
    let g = groups.find((x) => x.group === m.group);
    if (!g) groups.push((g = { group: m.group, models: [] }));
    g.models.push(m);
  }
  return groups;
}
