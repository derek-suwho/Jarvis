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
  { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', group: 'Anthropic', defaultReasoning: 'Medium' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', group: 'Anthropic', defaultReasoning: 'High' },
  { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', group: 'Anthropic', defaultReasoning: 'Medium' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', group: 'Google', defaultReasoning: 'Medium' },
  { id: 'grok-4.7', name: 'Grok 4.7', group: 'xAI', defaultReasoning: 'High', isNew: true },
  { id: 'grok-4.6', name: 'Grok 4.6', group: 'xAI', defaultReasoning: 'High' },
];

export interface ModelSettings {
  modelId: string;
  reasoning: Reasoning;
  context: ContextSize;
  fast: boolean;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  modelId: 'gpt-5.6-sol',
  reasoning: 'Medium',
  context: '272K',
  fast: false,
};

export function modelName(id: string): string {
  if (id === AUTO_MODEL_ID) return 'Auto';
  return MODEL_CATALOG.find((m) => m.id === id)?.name ?? id;
}

/** Trigger text: name plus muted detail, e.g. "GPT-5.6 Sol" + "Medium Fast". */
export function modelLabel(s: ModelSettings): { name: string; detail: string } {
  if (s.modelId === AUTO_MODEL_ID) return { name: 'Auto', detail: s.fast ? 'Fast' : '' };
  return { name: modelName(s.modelId), detail: [s.reasoning, s.fast ? 'Fast' : ''].filter(Boolean).join(' ') };
}

/** Groups matching models in catalog order, dropping empty groups. */
export function groupModels(query: string): { group: string; models: ModelInfo[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { group: string; models: ModelInfo[] }[] = [];
  for (const m of MODEL_CATALOG) {
    if (q && !m.name.toLowerCase().includes(q)) continue;
    let g = groups.find((x) => x.group === m.group);
    if (!g) groups.push((g = { group: m.group, models: [] }));
    g.models.push(m);
  }
  return groups;
}
