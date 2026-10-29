import type { Attachment } from './chats';
import { newId } from './chats';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

const MEDIA_EXTENSIONS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', pdf: 'application/pdf',
};
const MEDIA_TYPES = new Set(Object.values(MEDIA_EXTENSIONS));

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml',
  'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyi',
  'rb', 'rs', 'go', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh',
  'bash', 'zsh', 'sql', 'r', 'vue', 'svelte', 'log', 'ini', 'conf', 'cfg', 'env', 'gitignore',
  'dockerfile', 'graphql', 'gql', 'ipynb', 'tex', 'rst', 'diff', 'patch',
]);
const TEXT_FILENAMES = new Set(['makefile', 'dockerfile', 'license', 'readme']);
const TEXT_MIME_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/javascript',
  'application/typescript', 'application/x-yaml', 'application/yaml', 'application/toml',
]);
const UNSUPPORTED_MIME = /^(image\/|audio\/|video\/|font\/|application\/(pdf|zip|gzip|x-rar|vnd\.|msword))/i;

export const ATTACHMENT_ACCEPT = [
  'text/*', ...TEXT_MIME_TYPES, ...MEDIA_TYPES,
  ...[...TEXT_EXTENSIONS, ...Object.keys(MEDIA_EXTENSIONS)].map((ext) => `.${ext}`),
].join(',');

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** MIME wins when present; extension inference is only for untyped OS files. */
export function mediaType(file: Pick<FileLike, 'name' | 'type'>): string | undefined {
  const type = file.type.toLowerCase();
  if (type === 'image/jpg') return 'image/jpeg';
  if (MEDIA_TYPES.has(type)) return type;
  if (type && type !== 'application/octet-stream') return undefined;
  return MEDIA_EXTENSIONS[file.name.split('.').pop()!.toLowerCase()];
}

export function isTextFile(file: FileLike): boolean {
  const name = file.name.toLowerCase();
  const extension = name.slice(name.lastIndexOf('.') + 1);
  // Some operating systems label CSV as Excel even though its contents are plain text.
  if (extension === 'csv' && file.type === 'application/vnd.ms-excel') return true;
  if (UNSUPPORTED_MIME.test(file.type)) return false;
  return file.type.startsWith('text/') || TEXT_MIME_TYPES.has(file.type)
    || TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(name);
}

/** Validate before reading. Pending reads count toward both limits. */
export function vetFiles<T extends FileLike>(
  files: T[],
  alreadyAttached: number,
  alreadyAttachedBytes = 0,
): { accepted: T[]; errors: string[] } {
  const accepted: T[] = [];
  const errors: string[] = [];
  let totalBytes = alreadyAttachedBytes;
  for (const file of files) {
    const type = mediaType(file);
    const limit = type === 'application/pdf' ? MAX_PDF_BYTES : type ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (alreadyAttached + accepted.length >= MAX_FILES) {
      errors.push(`Up to ${MAX_FILES} files per message. Remove a file to add another.`);
      break;
    }
    if (!file.name.trim() || file.name.length > 255 || /[\u0000-\u001f\u007f]/.test(file.name)) {
      errors.push('Use a file name of up to 255 characters without control characters. Rename the file and try again.');
    } else if (file.size > limit) {
      errors.push(`${file.name} is larger than ${formatBytes(limit)}. Attach a smaller file or excerpt.`);
    } else if (file.size === 0) {
      errors.push(`${file.name} is empty. Choose a file with content.`);
    } else if (!type && !isTextFile(file)) {
      errors.push(`${file.name} isn't supported. Attach a PDF, PNG, JPEG, GIF, WebP, text, or code file.`);
    } else if (totalBytes + file.size > MAX_TOTAL_FILE_BYTES) {
      errors.push(`Files can total up to ${formatBytes(MAX_TOTAL_FILE_BYTES)}. Remove a file or attach a smaller excerpt.`);
    } else {
      accepted.push(file);
      totalBytes += file.size;
    }
  }
  return { accepted, errors: [...new Set(errors)] };
}

export const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp)$/.test(type);

function hasMediaSignature(bytes: Uint8Array, type: string): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  switch (type) {
    case 'image/png': return header.startsWith('\x89PNG\r\n\x1a\n');
    case 'image/jpeg': return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif': return header.startsWith('GIF87a') || header.startsWith('GIF89a');
    case 'image/webp': return header.startsWith('RIFF') && header.slice(8) === 'WEBP';
    case 'application/pdf':
      return header.startsWith('%PDF-') && new TextDecoder().decode(bytes.subarray(-1024)).includes('%%EOF');
    default: return false;
  }
}

/** Checks restored media too, before a draft is consumed. Returns actual decoded size. */
export function validateMediaData(file: { name: string; type: string; data: string }): number {
  const limit = file.type === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (!MEDIA_TYPES.has(file.type) || !file.name.trim() || file.name.length > 255 || /[\u0000-\u001f\u007f]/.test(file.name)) {
    throw new Error(`Invalid attachment ${JSON.stringify(file.name)}. Attach the file again.`);
  }
  if (file.data.length > Math.ceil(limit / 3) * 4) {
    throw new Error(`${file.name} is larger than ${formatBytes(limit)}. Attach a smaller file.`);
  }
  let bytes: Uint8Array;
  try {
    const decoded = atob(file.data);
    if (!decoded.length || btoa(decoded) !== file.data) throw new Error('Invalid base64');
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${file.name} has invalid file data. Attach the file again.`);
  }
  if (bytes.length > limit || !hasMediaSignature(bytes, file.type)) {
    throw new Error(`${file.name} is damaged or doesn't match its file type. Export it again and retry.`);
  }
  return bytes.length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase().slice(0, 4) : 'FILE';
}

export async function toAttachment(file: File): Promise<Attachment> {
  const { errors } = vetFiles([file], 0);
  if (errors.length) throw new Error(errors[0]);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error(`Couldn't read ${file.name}. Try adding it again.`);
  }
  const type = mediaType(file);
  if (type) {
    if (!hasMediaSignature(bytes, type)) {
      throw new Error(`${file.name} is damaged or doesn't match its file type. Export it again and retry.`);
    }
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    const data = btoa(chunks.join(''));
    return {
      id: newId(), name: file.name, size: bytes.length, type, data,
      ...(isImage(type) ? { preview: `data:${type};base64,${data}` } : {}),
    };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Couldn't read ${file.name}. Save it as UTF-8 text and try again.`);
  }
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) {
    throw new Error(`${file.name} contains binary data. Attach a plain-text version instead.`);
  }
  if (!text.trim()) throw new Error(`${file.name} has no text. Choose a file with content.`);
  return { id: newId(), name: file.name, size: file.size, type: file.type || 'text/plain', text };
}
