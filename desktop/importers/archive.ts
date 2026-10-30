import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import type { ImportLimits } from './types';

type ArchiveCode = 'INVALID_ARCHIVE' | 'UNSAFE_ARCHIVE' | 'LIMIT_EXCEEDED' | 'CANCELLED' | 'MISSING_CONVERSATIONS';
const messages: Record<ArchiveCode, string> = {
  INVALID_ARCHIVE: 'Invalid ZIP archive.',
  UNSAFE_ARCHIVE: 'Unsafe or unsupported ZIP archive.',
  LIMIT_EXCEEDED: 'Archive exceeds import limits.',
  CANCELLED: 'Import cancelled.',
  MISSING_CONVERSATIONS: 'Archive has no supported conversation document.',
};

export class ArchiveError extends Error {
  constructor(public readonly code: ArchiveCode) {
    super(messages[code]);
    this.name = 'ArchiveError';
  }
}

function requireRange(offset: number, size: number, end: number): void {
  if (offset < 0 || size < 0 || offset + size > end) throw new ArchiveError('INVALID_ARCHIVE');
}

function findEnd(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) return offset;
  }
  throw new ArchiveError('INVALID_ARCHIVE');
}

interface Entry {
  name: string;
  method: number;
  checksum: number;
  compressedSize: number;
  size: number;
  local: number;
  start: number;
  end: number;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError('CANCELLED');
}

function validateExtra(bytes: Buffer, offset: number, length: number): void {
  const end = offset + length;
  while (offset < end) {
    requireRange(offset, 4, end);
    if (bytes.readUInt16LE(offset) === 1) throw new ArchiveError('UNSAFE_ARCHIVE');
    const size = bytes.readUInt16LE(offset + 2);
    requireRange(offset + 4, size, end);
    offset += 4 + size;
  }
}

function validateName(raw: Buffer, limits: ImportLimits): string {
  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new ArchiveError('UNSAFE_ARCHIVE');
  }
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = path.split('/');
  if (!path || /[\\:\x00-\x1f\x7f]/.test(path) || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new ArchiveError('UNSAFE_ARCHIVE');
  }
  if (parts.length > limits.maxPathDepth) throw new ArchiveError('LIMIT_EXCEEDED');
  if (/\.(?:zip|zipx|tar|tgz|gz|bz2|xz|7z|rar|zst|lz|lzma|cab|iso)$/i.test(path)) throw new ArchiveError('UNSAFE_ARCHIVE');
  return name;
}

function descriptorEnd(bytes: Buffer, offset: number, directory: number, checksum: number, compressed: number, size: number): number {
  const matches = (start: number) => start + 12 <= directory
    && bytes.readUInt32LE(start) === checksum
    && bytes.readUInt32LE(start + 4) === compressed
    && bytes.readUInt32LE(start + 8) === size;
  if (offset + 4 <= directory && bytes.readUInt32LE(offset) === 0x08074b50 && matches(offset + 4)) return offset + 16;
  if (matches(offset)) return offset + 12;
  throw new ArchiveError('INVALID_ARCHIVE');
}

/** Validate the complete layout before inflating even the first entry. */
function parseEntries(bytes: Buffer, limits: ImportLimits): Entry[] {
  const end = findEnd(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const directory = bytes.readUInt32LE(end + 16);
  const directorySize = bytes.readUInt32LE(end + 12);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0
    || count === 0xffff || directory === 0xffffffff || directorySize === 0xffffffff) throw new ArchiveError('UNSAFE_ARCHIVE');
  if (bytes.readUInt16LE(end + 8) !== count || directory + directorySize !== end) throw new ArchiveError('INVALID_ARCHIVE');
  if (count > limits.maxFiles) throw new ArchiveError('LIMIT_EXCEEDED');
  let cursor = directory;
  let extractedSize = 0;
  const entries: Entry[] = [];
  const paths = new Set<string>();
  for (let i = 0; i < count; i++) {
    requireRange(cursor, 46, end);
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new ArchiveError('INVALID_ARCHIVE');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const local = bytes.readUInt32LE(cursor + 42);
    if ((flags & ~0x080e) !== 0 || (method !== 0 && method !== 8) || (method === 0 && (flags & 6) !== 0)
      || compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff
      || bytes.readUInt16LE(cursor + 34) !== 0) throw new ArchiveError('UNSAFE_ARCHIVE');
    requireRange(cursor + 46, nameLength + extraLength + commentLength, end);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = validateName(rawName, limits);
    const normalized = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (paths.has(normalized)) throw new ArchiveError('UNSAFE_ARCHIVE');
    paths.add(normalized);
    const type = (attributes >>> 16) & 0xf000;
    if (type !== 0 && type !== 0x8000 && type !== 0x4000) throw new ArchiveError('UNSAFE_ARCHIVE');
    if (((type === 0x4000 || (attributes & 0x10) !== 0) && !name.endsWith('/'))
      || (name.endsWith('/') && size !== 0)) throw new ArchiveError('UNSAFE_ARCHIVE');
    validateExtra(bytes, cursor + 46 + nameLength, extraLength);
    extractedSize += size;
    if (size > limits.maxFileBytes || extractedSize > limits.maxExtractedBytes
      || size / Math.max(1, compressedSize) > limits.maxCompressionRatio) throw new ArchiveError('LIMIT_EXCEEDED');
    requireRange(local, 30, directory);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags
      || bytes.readUInt16LE(local + 8) !== method) throw new ArchiveError('INVALID_ARCHIVE');
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    requireRange(local + 30, localNameLength + localExtraLength + compressedSize, directory);
    if (!rawName.equals(bytes.subarray(local + 30, local + 30 + localNameLength))) throw new ArchiveError('INVALID_ARCHIVE');
    validateExtra(bytes, local + 30 + localNameLength, localExtraLength);
    const descriptor = (flags & 8) !== 0;
    for (const [position, expected] of [[14, checksum], [18, compressedSize], [22, size]]) {
      const actual = bytes.readUInt32LE(local + position);
      if (actual !== expected && (!descriptor || actual !== 0)) throw new ArchiveError('INVALID_ARCHIVE');
    }
    const entryEnd = descriptor ? descriptorEnd(bytes, start + compressedSize, directory, checksum, compressedSize, size) : start + compressedSize;
    entries.push({ name, method, checksum, compressedSize, size, local, start, end: entryEnd });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new ArchiveError('INVALID_ARCHIVE');
  let covered = 0;
  for (const entry of [...entries].sort((a, b) => a.local - b.local)) {
    if (entry.local < covered) throw new ArchiveError('UNSAFE_ARCHIVE');
    if (entry.local !== covered) throw new ArchiveError('INVALID_ARCHIVE');
    covered = entry.end;
  }
  if (covered !== directory) throw new ArchiveError('INVALID_ARCHIVE');
  return entries;
}

function isNestedArchive(data: Buffer): boolean {
  return (data.length >= 4 && [0x04034b50, 0x06054b50, 0x08074b50].includes(data.readUInt32LE(0)))
    || (data[0] === 0x1f && data[1] === 0x8b)
    || data.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    || data.subarray(0, 4).equals(Buffer.from('Rar!'))
    || data.subarray(0, 3).equals(Buffer.from('BZh'))
    || data.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]))
    || data.subarray(257, 262).equals(Buffer.from('ustar'));
}

export async function readArchive(input: Uint8Array, limits: ImportLimits, signal?: AbortSignal): Promise<{
  documents: Uint8Array[];
  skippedArtifacts: number;
}> {
  checkCancelled(signal);
  if (input.byteLength > limits.maxInputBytes) throw new ArchiveError('LIMIT_EXCEEDED');
  // Snapshot before yielding so caller mutation cannot alter validated headers.
  const bytes = Buffer.from(input);
  try {
    const entries = parseEntries(bytes, limits);
    const documents: { name: string; data: Uint8Array }[] = [];
    let skippedArtifacts = 0;
    let extractedBytes = 0;
    for (const entry of entries) {
      await yieldToEventLoop();
      checkCancelled(signal);
      const compressed = bytes.subarray(entry.start, entry.start + entry.compressedSize);
      const budget = Math.min(limits.maxFileBytes, limits.maxExtractedBytes - extractedBytes);
      let data: Buffer;
      try {
        if (entry.method === 8) {
          // Node's type declarations omit the documented info:true return shape.
          const inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(1, budget), info: true }) as unknown as {
            buffer: Buffer;
            engine: { bytesWritten: number };
          };
          if (inflated.engine.bytesWritten !== compressed.length) throw new ArchiveError('INVALID_ARCHIVE');
          data = inflated.buffer;
        } else {
          data = compressed;
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') throw new ArchiveError('LIMIT_EXCEEDED');
        throw new ArchiveError('INVALID_ARCHIVE');
      }
      if (data.length > budget) throw new ArchiveError('LIMIT_EXCEEDED');
      if (data.length !== entry.size || crc32(data) !== entry.checksum) throw new ArchiveError('INVALID_ARCHIVE');
      extractedBytes += data.length;
      if (isNestedArchive(data)) throw new ArchiveError('UNSAFE_ARCHIVE');
      if (/(?:^|\/)conversations(?:-\d+)?\.json$/.test(entry.name)) documents.push({ name: entry.name, data });
      else skippedArtifacts++;
    }
    checkCancelled(signal);
    if (!documents.length) throw new ArchiveError('MISSING_CONVERSATIONS');
    documents.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { documents: documents.map(item => item.data), skippedArtifacts };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('INVALID_ARCHIVE');
  }
}
