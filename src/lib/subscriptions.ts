export interface Provider {
  id: string;
  name: string;
  company: string;
  /** Used for the provider's favicon. */
  site: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', site: 'chatgpt.com' },
  { id: 'anthropic', name: 'Claude', company: 'Anthropic', site: 'claude.ai' },
  { id: 'google', name: 'Gemini', company: 'Google', site: 'gemini.google.com' },
  { id: 'xai', name: 'Grok', company: 'xAI', site: 'grok.com' },
];

/** Display-only names follow OpenAI's plan enum; unknown is never guessed. */
export function chatGPTPlanLabel(value: unknown): string {
  const labels: Record<string, string> = {
    free: 'Free', go: 'Go', plus: 'Plus', prolite: 'Pro', pro: 'Pro (More)', promax: 'Pro (Max)',
    team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu',
  };
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : 'Plan unavailable';
}
