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
