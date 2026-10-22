export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
  model?: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  pinned?: boolean;
}

const STORAGE_KEY = 'jarvis.chats';
const TITLE_MAX = 40;

export const newId = (): string => crypto.randomUUID();

export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX).trimEnd()}…` : t;
}

export function createChat(now = Date.now()): Chat {
  return { id: newId(), title: 'New chat', messages: [], updatedAt: now };
}

/** Appends a message; the first user message also names the chat. */
export function appendMessage(chats: Chat[], chatId: string, msg: Message, now = Date.now()): Chat[] {
  return chats.map((c) =>
    c.id !== chatId
      ? c
      : {
          ...c,
          title: c.messages.length === 0 && msg.role === 'user' ? titleFrom(msg.content) : c.title,
          messages: [...c.messages, msg],
          updatedAt: now,
        },
  );
}

export function sortByRecent(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function filterChats(chats: Chat[], query: string): Chat[] {
  const q = query.trim().toLowerCase();
  if (!q) return chats;
  return chats.filter(
    (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
  );
}

export function renameChat(chats: Chat[], id: string, title: string): Chat[] {
  const t = title.trim();
  return t ? chats.map((c) => (c.id === id ? { ...c, title: t } : c)) : chats;
}

export function togglePin(chats: Chat[], id: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
}

/** Drops a message and everything after it, as editing or regenerating does. */
export function truncateFrom(chats: Chat[], chatId: string, messageId: string): Chat[] {
  return chats.map((c) => {
    if (c.id !== chatId) return c;
    const i = c.messages.findIndex((m) => m.id === messageId);
    return i < 0 ? c : { ...c, messages: c.messages.slice(0, i) };
  });
}

const DAY_MS = 86_400_000;

/** Sidebar sections: Pinned first, then recency buckets relative to local midnight. Empty groups are dropped. */
export function groupChats(chats: Chat[], now = Date.now()): { label: string; chats: Chat[] }[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const buckets: [string, number][] = [
    ['Today', midnight],
    ['Yesterday', midnight - DAY_MS],
    ['Previous 7 days', midnight - 7 * DAY_MS],
    ['Previous 30 days', midnight - 30 * DAY_MS],
    ['Older', -Infinity],
  ];
  const groups = [{ label: 'Pinned', chats: [] as Chat[] }, ...buckets.map(([label]) => ({ label, chats: [] as Chat[] }))];
  for (const c of sortByRecent(chats)) {
    if (c.pinned) groups[0].chats.push(c);
    else groups[1 + buckets.findIndex(([, start]) => c.updatedAt >= start)].chats.push(c);
  }
  return groups.filter((g) => g.chats.length > 0);
}

export function greeting(hour = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function isChat(v: unknown): v is Chat {
  const c = v as Chat;
  return !!c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages);
}

export function loadChats(): Chat[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isChat) : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // Storage unavailable (private mode, quota) — keep in memory only.
  }
}

/** Placeholder until provider adapters exist. */
export function mockReply(prompt: string, model: string): string {
  return `(${model} placeholder) No provider is connected yet. You said: "${titleFrom(prompt)}"`;
}
