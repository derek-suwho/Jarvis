import type { Attachment } from './chats';
import { newId } from './chats';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 512 * 1024;

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** Splits picked files into accepted ones and human-readable rejections. */
export function vetFiles<T extends FileLike>(files: T[], alreadyAttached: number): { accepted: T[]; errors: string[] } {
  const accepted: T[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (alreadyAttached + accepted.length >= MAX_FILES) {
      errors.push(`Up to ${MAX_FILES} files per message.`);
      break;
    }
    if (f.size > MAX_FILE_BYTES) errors.push(`${f.name} is larger than 20 MB.`);
    else if (f.size === 0) errors.push(`${f.name} is empty.`);
    else accepted.push(f);
  }
  return { accepted, errors };
}

export const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp)$/.test(type);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase().slice(0, 4) : 'FILE';
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function toAttachment(file: File): Promise<Attachment> {
  const base = { id: newId(), name: file.name, size: file.size, type: file.type };
  if (!isImage(file.type) || file.size > PREVIEW_MAX_BYTES) return base;
  try {
    return { ...base, preview: await readDataUrl(file) };
  } catch {
    return base;
  }
}
