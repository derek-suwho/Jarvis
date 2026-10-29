export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Personal settings, stored on this device only. */
export interface Preferences {
  name: string;
  theme: Theme;
  /** Custom instructions applied to every new chat, like ChatGPT/Claude personalization. */
  instructions: string;
  desktopTaskNotifications: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { name: '', theme: 'dark', instructions: '', desktopTaskNotifications: true };

const STORAGE_KEY = 'jarvis.preferences';
const NAME_MAX = 40;
const INSTRUCTIONS_MAX = 1500;

export function sanitizePreferences(value: unknown): Preferences {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    name: typeof v.name === 'string' ? v.name.slice(0, NAME_MAX) : '',
    theme: THEMES.includes(v.theme as Theme) ? (v.theme as Theme) : DEFAULT_PREFERENCES.theme,
    instructions: typeof v.instructions === 'string' ? v.instructions.slice(0, INSTRUCTIONS_MAX) : '',
    desktopTaskNotifications: typeof v.desktopTaskNotifications === 'boolean' ? v.desktopTaskNotifications : true,
  };
}

export function loadPreferences(): Preferences {
  try {
    return sanitizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable — keep in memory only.
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Y';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function greeting(name: string, hour = new Date().getHours()): string {
  const part = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
