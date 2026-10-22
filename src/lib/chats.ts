export type Role = 'user' | 'assistant';
export type Feedback = 'up' | 'down';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Data URL kept only for small images so the thumbnail survives reloads. */
  preview?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  model?: string;
  attachments?: Attachment[];
  feedback?: Feedback;
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
}

const STORAGE_KEY = 'jarvis.chats';
const TITLE_MAX = 40;

export const newId = (): string => crypto.randomUUID();

export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX).trimEnd()}…` : t;
}

export function createChat(now = Date.now(), extra: Partial<Chat> = {}): Chat {
  return { id: newId(), title: 'New chat', messages: [], updatedAt: now, ...extra };
}

export function updateChat(chats: Chat[], id: string, patch: Partial<Chat>): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function updateMessage(chats: Chat[], chatId: string, messageId: string, patch: Partial<Message>): Chat[] {
  return chats.map((c) =>
    c.id !== chatId ? c : { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) },
  );
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

/** Chats shown in the sidebar history: saved, unarchived, outside any project. */
export function recentChats(chats: Chat[]): Chat[] {
  return chats.filter((c) => !c.temporary && !c.archived && !c.projectId);
}

export function chatToMarkdown(chat: Chat): string {
  const parts = chat.messages.map((m) => {
    const who = m.role === 'user' ? 'You' : (m.model ?? 'Assistant');
    const files = m.attachments?.length ? `\n\n_Attached: ${m.attachments.map((a) => a.name).join(', ')}_` : '';
    return `**${who}:**\n\n${m.content}${files}`;
  });
  return [`# ${chat.title}`, ...parts].join('\n\n---\n\n') + '\n';
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.filter((c) => !c.temporary)));
  } catch {
    // Storage unavailable (private mode, quota) — keep in memory only.
  }
}

/** Splits a reply into word-sized pieces for the simulated stream, keeping whitespace. */
export function streamChunks(text: string, wordsPerChunk = 2): string[] {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) out.push(tokens.slice(i, i + wordsPerChunk).join(''));
  return out;
}

/** Placeholder until provider adapters exist. */
export function mockReply(prompt: string, model: string, attachments: Attachment[] = []): string {
  const files = attachments.length ? ` with ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : '';
  return [
    `**${model}** placeholder — no provider is connected yet.`,
    '',
    `You said${files}: "${titleFrom(prompt)}"`,
    '',
    'Once a subscription is connected, replies stream here with:',
    '- **Markdown** formatting and `inline code`',
    '- Fenced code blocks with a copy button',
    '- Tables, lists and quotes',
    '',
    '```ts',
    `const reply = await provider.send(${JSON.stringify(titleFrom(prompt))});`,
    '```',
  ].join('\n');
}
