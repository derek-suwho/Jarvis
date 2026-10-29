import type { Attachment } from './chats';
import { toAttachment, vetFiles } from './attachments';

export interface Draft {
  text: string;
  attachments: Attachment[];
  pendingFiles: number;
  errors: string[];
}

interface DraftRecord {
  snapshot: Draft;
  persistent: boolean;
  pendingBytes: number;
  generation: number;
  listeners: Set<() => void>;
}

const drafts = new Map<string, DraftRecord>();
const STORAGE_PREFIX = 'jarvis.draft:';
const emptyDraft = (): Draft => ({ text: '', attachments: [], pendingFiles: 0, errors: [] });

function recordFor(key: string, persistent = true): DraftRecord {
  let record = drafts.get(key);
  if (!record) {
    const snapshot = emptyDraft();
    if (persistent) {
      try {
        snapshot.text = sessionStorage.getItem(STORAGE_PREFIX + key) ?? '';
      } catch {
        // Storage may be unavailable; drafts still survive navigation in memory.
      }
    }
    record = { snapshot, persistent, pendingBytes: 0, generation: 0, listeners: new Set() };
    drafts.set(key, record);
  }
  record.persistent = persistent;
  return record;
}

function publish(key: string, record: DraftRecord, patch: Partial<Draft>): void {
  record.snapshot = { ...record.snapshot, ...patch };
  try {
    if (record.persistent && record.snapshot.text) {
      sessionStorage.setItem(STORAGE_PREFIX + key, record.snapshot.text);
    } else {
      sessionStorage.removeItem(STORAGE_PREFIX + key);
    }
  } catch {
    // Attachments deliberately stay in memory; text persistence is best effort.
  }
  record.listeners.forEach((listener) => listener());
}

/** Stable snapshots for useSyncExternalStore. Attachments never enter sessionStorage. */
export function getDraft(key: string, persistent = true): Draft {
  return recordFor(key, persistent).snapshot;
}

export function subscribeToDraft(key: string, listener: () => void, persistent = true): () => void {
  const record = recordFor(key, persistent);
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

export function setDraftText(key: string, text: string, persistent = true): void {
  publish(key, recordFor(key, persistent), { text });
}

export function removeDraftAttachment(key: string, id: string, persistent = true): void {
  const record = recordFor(key, persistent);
  publish(key, record, { attachments: record.snapshot.attachments.filter((file) => file.id !== id) });
}

export function clearDraftErrors(key: string, persistent = true): void {
  publish(key, recordFor(key, persistent), { errors: [] });
}

/** Clear before onSend changes the active conversation, so its draft cannot be overwritten. */
export function clearDraft(key: string, persistent = true): void {
  const record = recordFor(key, persistent);
  record.generation += 1;
  record.pendingBytes = 0;
  publish(key, record, emptyDraft());
}

export interface SubmittedDraft {
  draft: Draft;
  generation: number;
}

export function captureDraft(key: string, persistent = true): SubmittedDraft {
  const record = recordFor(key, persistent);
  return { draft: record.snapshot, generation: record.generation };
}

/** A receipt consumes only content that was submitted, retaining edits made during IPC. */
export function consumeSubmittedDraft(key: string, submitted: SubmittedDraft, persistent = true): void {
  const record = recordFor(key, persistent);
  if (record.generation !== submitted.generation) return;
  const current = record.snapshot;
  const sent = submitted.draft;
  const text = current.text === sent.text ? '' :
    sent.text && current.text.startsWith(sent.text) ? current.text.slice(sent.text.length) : current.text;
  const sentIds = new Set(sent.attachments.map((attachment) => attachment.id));
  publish(key, record, { text, attachments: current.attachments.filter((attachment) => !sentIds.has(attachment.id)), errors: [] });
}

/** Data controls must also remove drafts restored from earlier page sessions. */
export function clearAllDrafts(): void {
  for (const [key, record] of drafts) clearDraft(key, record.persistent);
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // In-memory drafts were still cleared if browser storage is unavailable.
  }
}

/** Reserve slots synchronously; overlapping picks and navigation cannot exceed limits or move files. */
export async function attachDraftFiles(key: string, files: File[], persistent = true): Promise<number> {
  const record = recordFor(key, persistent);
  const current = record.snapshot;
  const attachedBytes = current.attachments.reduce((total, file) => total + file.size, 0);
  const { accepted, errors } = vetFiles(files, current.attachments.length + current.pendingFiles, attachedBytes + record.pendingBytes);
  const pendingBytes = accepted.reduce((total, file) => total + file.size, 0);
  const generation = record.generation;
  record.pendingBytes += pendingBytes;
  publish(key, record, { pendingFiles: current.pendingFiles + accepted.length, errors });
  if (!accepted.length) return 0;

  const results = await Promise.allSettled(accepted.map(toAttachment));
  if (record.generation !== generation) return 0;
  const attachments: Attachment[] = [];
  const readErrors: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') attachments.push(result.value);
    else readErrors.push(result.reason instanceof Error ? result.reason.message : 'A file could not be read. Try adding it again.');
  }
  record.pendingBytes -= pendingBytes;
  publish(key, record, {
    attachments: [...record.snapshot.attachments, ...attachments],
    pendingFiles: record.snapshot.pendingFiles - accepted.length,
    errors: [...new Set([...record.snapshot.errors, ...readErrors])],
  });
  return attachments.length;
}
