import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
  deflate?: boolean;
  descriptor?: 'signed' | 'unsigned';
  mode?: number;
}

/** Synthetic ZIP writer for archive-boundary tests; never extracts files. */
export function zip(entries: ZipEntry[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.content);
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw);
    const flags = 0x0800 | (entry.descriptor ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    if (!entry.descriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(entry.descriptor === 'signed' ? 16 : entry.descriptor ? 12 : 0);
    if (entry.descriptor) {
      const base = entry.descriptor === 'signed' ? 4 : 0;
      if (base) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, base);
      descriptor.writeUInt32LE(data.length, base + 4);
      descriptor.writeUInt32LE(raw.length, base + 8);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0x81a4) * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data, descriptor);
    centrals.push(central, name);
    offset += local.length + name.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const commentBytes = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, end, commentBytes]);
}

export function centralOffset(archive: Buffer): number {
  return archive.readUInt32LE(archive.length - 6);
}
