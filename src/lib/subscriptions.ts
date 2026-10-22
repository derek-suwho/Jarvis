export interface Provider {
  id: string;
  name: string;
  company: string;
  /** Used for the provider's favicon. */
  site: string;
  plans: string[];
}

export const PROVIDERS: Provider[] = [
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', site: 'chatgpt.com', plans: ['Free', 'Go', 'Plus', 'Pro', 'Business'] },
  { id: 'anthropic', name: 'Claude', company: 'Anthropic', site: 'claude.ai', plans: ['Free', 'Pro', 'Max 5x', 'Max 20x', 'Team'] },
  { id: 'google', name: 'Gemini', company: 'Google', site: 'gemini.google.com', plans: ['Free', 'AI Pro', 'AI Ultra'] },
  { id: 'xai', name: 'Grok', company: 'xAI', site: 'grok.com', plans: ['Free', 'SuperGrok', 'SuperGrok Heavy'] },
];

/** Provider id -> plan name. Only which plan the user has; no credentials are stored. */
export type Subscriptions = Record<string, string>;

const STORAGE_KEY = 'jarvis.subscriptions';

/** Keeps only known providers with one of their listed plans. */
export function sanitizeSubscriptions(value: unknown): Subscriptions {
  if (!value || typeof value !== 'object') return {};
  const out: Subscriptions = {};
  for (const p of PROVIDERS) {
    const plan = (value as Record<string, unknown>)[p.id];
    if (typeof plan === 'string' && p.plans.includes(plan)) out[p.id] = plan;
  }
  return out;
}

export function loadSubscriptions(): Subscriptions {
  try {
    return sanitizeSubscriptions(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function saveSubscriptions(subs: Subscriptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch {
    // Storage unavailable — keep in memory only.
  }
}

export function setPlan(subs: Subscriptions, providerId: string, plan: string | null): Subscriptions {
  const next = { ...subs };
  if (plan === null) delete next[providerId];
  else next[providerId] = plan;
  return sanitizeSubscriptions(next);
}
