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
type CheckpointBarrier = { run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
const checkpointQueue: (PendingSave | CheckpointBarrier)[] = [];
let saving = false;
let lastRetainedMediaIds: Set<string> | undefined;
let desktopChats: Chat[] | undefined;
let desktopRestoreReady = false;
let desktopMediaAuthoritative = false;
const checkpointBridge = () => typeof window === 'undefined' ? undefined : window.jarvis?.checkpoints;

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
  if (desktopChats !== undefined) return desktopChats;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isChat).filter((chat) => !chat.temporary) : [];
  } catch {
    return [];
  }
}

/** Load saved bytes before the first chat render; a missing file remains an explicit unavailable attachment. */
export async function initializeChatMedia(): Promise<void> {
  const checkpoints = checkpointBridge();
  if (checkpoints) {
    try {
      // Null alone permits migration from the browser archive; [] means deleted history.
      const restored = await checkpoints.load();
      desktopMediaAuthoritative = restored !== null;
      desktopChats = restored ?? readChatMetadata();
      desktopRestoreReady = true;
    } catch {
      desktopChats = [];
      storageError('Could not restore saved conversations. Reopen Jarvis before saving new conversations.');
      return;
    }
  }
  const attachments = readChatMetadata().flatMap((chat) => chat.messages.flatMap((message) => message.attachments ?? []));
  // SQLite restores complete attachment payloads. ID-only browser caches can
  // alias reused IDs or revive stale bytes; consult them only for migration.
  if (desktopMediaAuthoritative) {
    if (attachments.some((attachment) => mediaType(attachment.type) && !inlineMedia(attachment))) {
      storageError('Some saved attachments are unavailable. Reattach the original files in a new chat.');
    }
    return;
  }
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
          const media = inlineMedia(attachment) ?? (desktopMediaAuthoritative ? undefined : mediaCache.get(attachment.id));
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

/** Omit only image previews that restore can reconstruct exactly from source bytes. */
function desktopCheckpointSnapshot(chats: Chat[]): Chat[] {
  return chats.filter((chat) => !chat.temporary).map((chat) => ({
    ...chat,
    messages: chat.messages.map((message) => ({
      ...message,
      ...(message.attachments ? { attachments: message.attachments.map((attachment) => {
        // The renderer reconstructs this preview from data on restore. Sending
        // both doubles image history size before the main process can split media.
        if (attachment.data !== undefined && imageType(attachment.type)
          && attachment.preview === `data:${attachment.type};base64,${attachment.data}`) {
          const { preview: _preview, ...media } = attachment;
          return media;
        }
        return attachment;
      }) } : {}),
    })),
  }));
}

/** Serialized saves preserve ordering and never put media bytes in localStorage. */
async function writeChats(chats: Chat[]): Promise<void> {
  const checkpoints = checkpointBridge();
  if (checkpoints) {
    if (!desktopRestoreReady) throw new Error('Desktop conversation restore is unavailable.');
    const saved = desktopCheckpointSnapshot(chats);
    if (!await checkpoints.save(saved)) throw new Error('Desktop checkpoint was not saved.');
    desktopChats = saved;
    return;
  }
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
    // Capture the accepted state before yielding to the queued writer. Callers
    // retain their objects and may edit them while a durable save is pending.
    // Temporary history is never durable; exclude it before copying potentially
    // large media into the queue, rather than only at the eventual writer.
    const durable = chats.filter((chat) => !chat.temporary);
    const snapshot = structuredClone(checkpointBridge() ? desktopCheckpointSnapshot(durable) : durable);
    const pending = checkpointQueue.at(-1);
    if (pending && 'chats' in pending) {
      pending.chats = snapshot;
      pending.resolve.push(resolve);
      pending.reject.push(reject);
    } else checkpointQueue.push({ chats: snapshot, resolve: [resolve], reject: [reject] });
  });
  drainCheckpoints();
  return receipt;
}

/** Order destructive maintenance between accepted checkpoint writes.
 * Callers must also fence stale renderer state before accepting new saves.
 */
export function withChatCheckpointBarrier(run: () => Promise<void>): Promise<void> {
  const receipt = new Promise<void>((resolve, reject) => {
    checkpointQueue.push({ run, resolve, reject });
  });
  drainCheckpoints();
  return receipt;
}

/** Refresh the renderer cache from durable deletion results before releasing maintenance.
 * Callers must pause renderer saves until they have consumed loadChats(). Failed
 * maintenance or reload blocks desktop saves until authoritative reconciliation.
 */
export function reconcileChatCheckpoint(run: () => Promise<void>): Promise<void> {
  return withChatCheckpointBarrier(async () => {
    const checkpoints = checkpointBridge();
    if (!checkpoints) throw new Error('Desktop conversation storage is unavailable.');
    // Maintenance can commit before its receipt fails. Fence stale evidence even
    // when the operation rejects; only an authoritative reload may reopen saves.
    desktopRestoreReady = false;
    desktopChats = [];
    mediaCache.clear();
    persistedMediaIds.clear();
    await run();
    const restored = await checkpoints.load();
    if (restored === null) throw new Error('Desktop conversation checkpoint is unavailable.');
    desktopChats = restored;
    desktopMediaAuthoritative = true;
    desktopRestoreReady = true;
  });
}

function drainCheckpoints(): void {
  if (saving) return;
  saving = true;
  queueMicrotask(async () => {
    while (checkpointQueue.length) {
      const operation = checkpointQueue.shift()!;
      try {
        if ('chats' in operation) {
          await writeChats(operation.chats);
          operation.resolve.forEach((resolve) => resolve());
        } else {
          await operation.run();
          operation.resolve();
        }
      } catch (error) {
        if ('chats' in operation) {
          storageError('Could not save this conversation or its attachments. Keep Jarvis open and free storage space before retrying.');
          operation.reject.forEach((reject) => reject(error));
        } else operation.reject(error);
      }
    }
    saving = false;
  });
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
