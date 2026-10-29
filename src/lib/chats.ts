import { pruneMedia, readMedia, writeMedia } from './mediaStore';
import type { StoredMedia } from './mediaStore';
import type { Attachment, Chat, Feedback, Message, Role, ToolUse } from '../shared/chatTypes';
export type { Attachment, Chat, Feedback, Message, Role, ToolUse } from '../shared/chatTypes';

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

const mediaCache = new Map<string, StoredMedia>();
const persistedMediaIds = new Set<string>();
const storageErrorListeners = new Set<(message: string) => void>();
let pendingStorageError: string | null = null;
type PendingSave = { chats: Chat[]; resolve: (() => void)[]; reject: ((error: unknown) => void)[] };
let pendingSave: PendingSave | undefined;
let saving = false;
let lastRetainedMediaIds: Set<string> | undefined;

function storageError(message: string): void {
  if (storageErrorListeners.size) {
    for (const listener of storageErrorListeners) listener(message);
  } else {
    pendingStorageError = message;
  }
}

/** Also delivers restore failures that occurred before React mounted. */
export function subscribeToChatStorageErrors(listener: (message: string) => void): () => void {
  storageErrorListeners.add(listener);
  if (pendingStorageError) {
    const message = pendingStorageError;
    pendingStorageError = null;
    listener(message);
  }
  return () => { storageErrorListeners.delete(listener); };
}

const normalizedMediaType = (type: string) => type === 'image/jpg' ? 'image/jpeg' : type;
const imageType = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(normalizedMediaType(type));
const mediaType = (type: string) => type === 'application/pdf' || imageType(type);

/** Old chats may contain only a complete image data URL. Preserve it during migration. */
function inlineMedia(attachment: Attachment): StoredMedia | undefined {
  if (!mediaType(attachment.type)) return undefined;
  const type = normalizedMediaType(attachment.type);
  if (attachment.data) return { id: attachment.id, type, data: attachment.data };
  const preview = attachment.preview;
  const prefix = [`data:${attachment.type};base64,`, `data:${type};base64,`]
    .find((value) => preview?.startsWith(value));
  if (imageType(type) && prefix && preview) {
    return { id: attachment.id, type, data: preview.slice(prefix.length) };
  }
  return undefined;
}

function readChatMetadata(): Chat[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isChat).filter((chat) => !chat.temporary) : [];
  } catch {
    return [];
  }
}

/** Load saved bytes before the first chat render; a missing file remains an explicit unavailable attachment. */
export async function initializeChatMedia(): Promise<void> {
  const attachments = readChatMetadata().flatMap((chat) => chat.messages.flatMap((message) => message.attachments ?? []));
  const missingIds: string[] = [];
  for (const attachment of attachments) {
    const inline = inlineMedia(attachment);
    if (inline) mediaCache.set(attachment.id, inline);
    else if (mediaType(attachment.type)) missingIds.push(attachment.id);
  }
  try {
    for (const row of await readMedia(missingIds)) {
      const type = normalizedMediaType(row.type);
      mediaCache.set(row.id, { ...row, type });
      if (type === row.type) persistedMediaIds.add(row.id);
    }
    if (missingIds.some((id) => !mediaCache.has(id))) {
      storageError('Some saved attachments are unavailable. Reattach the original files in a new chat.');
    }
  } catch {
    storageError('Could not restore saved attachments. Reopen Jarvis or reattach the original files in a new chat.');
  }
}

export function loadChats(): Chat[] {
  return readChatMetadata().map((chat) => ({
    ...chat,
    messages: chat.messages.map((message) => ({
      ...message,
      ...(message.attachments ? {
        attachments: message.attachments.map((attachment) => {
          const media = inlineMedia(attachment) ?? mediaCache.get(attachment.id);
          if (!media || media.type !== normalizedMediaType(attachment.type)) return attachment;
          return {
            ...attachment,
            type: media.type,
            data: media.data,
            ...(imageType(media.type) ? { preview: `data:${media.type};base64,${media.data}` } : {}),
          };
        }),
      } : {}),
    })),
  }));
}

/** Serialized saves preserve ordering and never put media bytes in localStorage. */
async function writeChats(chats: Chat[]): Promise<void> {
  const rows = new Map<string, StoredMedia>();
  const retainedIds = new Set<string>();
  const metadata = chats.filter((chat) => !chat.temporary).map((chat) => ({
    ...chat,
    messages: chat.messages.map((message) => ({
      ...message,
      ...(message.attachments ? {
        attachments: message.attachments.map((attachment) => {
          const media = inlineMedia(attachment);
          if (media) rows.set(media.id, media);
          if (mediaType(attachment.type)) retainedIds.add(attachment.id);
          const { data: _data, preview: _preview, ...details } = attachment;
          return { ...details, type: normalizedMediaType(details.type) };
        }),
      } : {}),
    })),
  }));
  const serialized = JSON.stringify(metadata);

  {
    const changed = [...rows.values()].filter((row) => {
      const cached = mediaCache.get(row.id);
      return !persistedMediaIds.has(row.id) || !cached || cached.type !== row.type || cached.data !== row.data;
    });
    // Inline legacy data is cached during startup but has not necessarily reached IndexedDB.
    await writeMedia(changed);
    for (const row of rows.values()) persistedMediaIds.add(row.id);
    localStorage.setItem(STORAGE_KEY, serialized);
    for (const row of rows.values()) mediaCache.set(row.id, row);
    const previousRetainedIds = lastRetainedMediaIds;
    if (!previousRetainedIds || previousRetainedIds.size !== retainedIds.size
      || [...retainedIds].some((id) => !previousRetainedIds.has(id))) {
      await pruneMedia(retainedIds);
      lastRetainedMediaIds = retainedIds;
    }
    for (const id of mediaCache.keys()) {
      if (!retainedIds.has(id)) mediaCache.delete(id);
    }
    for (const id of persistedMediaIds) {
      if (!retainedIds.has(id)) persistedMediaIds.delete(id);
    }
  }
}

/** Coalesce pending checkpoints; receipts resolve only after media and metadata are durable. */
export function saveChats(chats: Chat[]): Promise<void> {
  const receipt = new Promise<void>((resolve, reject) => {
    if (pendingSave) {
      pendingSave.chats = chats;
      pendingSave.resolve.push(resolve);
      pendingSave.reject.push(reject);
    } else pendingSave = { chats, resolve: [resolve], reject: [reject] };
  });
  if (!saving) {
    saving = true;
    queueMicrotask(async () => {
      while (pendingSave) {
        const save = pendingSave;
        pendingSave = undefined;
        try {
          await writeChats(save.chats);
          save.resolve.forEach((resolve) => resolve());
        } catch (error) {
          storageError('Could not save this conversation or its attachments. Keep Jarvis open and free storage space before retrying.');
          save.reject.forEach((reject) => reject(error));
        }
      }
      saving = false;
    });
  }
  return receipt;
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
    `**${model}** isn't connected yet, so this is a placeholder reply. Connect ChatGPT or Claude in Settings and pick one of their models.`,
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
