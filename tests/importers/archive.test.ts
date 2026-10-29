import { describe, expect, it } from 'vitest';
import { readArchive } from '../../desktop/importers/archive';
import type { ImportLimits } from '../../desktop/importers/types';
import { centralOffset, zip } from './zip-fixture';

const limits: ImportLimits = {
  maxInputBytes: 1_000_000,
  maxExtractedBytes: 1_000_000,
  maxFileBytes: 500_000,
  maxFiles: 100,
  maxCompressionRatio: 100,
  maxPathDepth: 8,
  maxJsonDepth: 32,
  maxConversations: 100,
  maxMessages: 1000,
  maxTextLength: 100_000,
  maxTotalTextLength: 500_000,
};

function read(archive: Uint8Array, overrides: Partial<ImportLimits> = {}, signal?: AbortSignal) {
  return readArchive(archive, { ...limits, ...overrides }, signal);
}

describe('bounded ZIP export reader', () => {
  it('reads a stored conversations document without extracting it to disk', async () => {
    await expect(read(zip([{ name: 'conversations.json', content: '[{"synthetic":true}]' }])))
      .resolves.toEqual({ documents: [Buffer.from('[{"synthetic":true}]')], skippedArtifacts: 0 });
  });

  it('sorts conversation shards and counts ignored artifacts', async () => {
    await expect(read(zip([
      { name: 'export/conversations-2.json', content: '[2]' },
      { name: 'export/image.png', content: 'image' },
      { name: 'export/conversations-1.json', content: '[1]' },
      { name: 'export/not-conversations.json', content: 'ignored' },
    ]))).resolves.toEqual({ documents: [Buffer.from('[1]'), Buffer.from('[2]')], skippedArtifacts: 2 });
  });

  it.each([undefined, 'signed', 'unsigned'] as const)('reads deflated JSON with %s data descriptor', async (descriptor) => {
    await expect(read(zip([{ name: 'conversations.json', content: '[{"test":"deflated"}]', deflate: true, descriptor }])))
      .resolves.toEqual({ documents: [Buffer.from('[{"test":"deflated"}]')], skippedArtifacts: 0 });
  });

  it('allows ZIP comments without treating their content as headers', async () => {
    await expect(read(zip([{ name: 'conversations.json', content: '[]' }], 'synthetic comment')))
      .resolves.toEqual({ documents: [Buffer.from('[]')], skippedArtifacts: 0 });
  });

  it.each([
    ['empty', () => Buffer.alloc(0)],
    ['not zip', () => Buffer.from('arbitrary private text')],
    ['truncated', () => zip([{ name: 'conversations.json', content: '[]' }]).subarray(0, -5)],
    ['bad central signature', () => {
      const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
      bytes.writeUInt32LE(0, centralOffset(bytes));
      return bytes;
    }],
    ['bad local signature', () => {
      const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
      bytes.writeUInt32LE(0, 0);
      return bytes;
    }],
    ['wrong directory length', () => {
      const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
      bytes.writeUInt32LE(1, bytes.length - 10);
      return bytes;
    }],
  ])('rejects %s with a safe archive error', async (_label, build) => {
    await expect(read((build as () => Buffer)())).rejects.toMatchObject({ code: 'INVALID_ARCHIVE', message: 'Invalid ZIP archive.' });
  });

  it('rejects archives without a supported conversation document', async () => {
    await expect(read(zip([{ name: 'chat.html', content: '<html>private</html>' }])))
      .rejects.toMatchObject({ code: 'MISSING_CONVERSATIONS' });
  });

  it.each([
    '../conversations.json', '/conversations.json', 'C:/conversations.json',
    'folder\\conversations.json', 'a/../conversations.json', './conversations.json',
    'a//conversations.json', 'secret\u0000/conversations.json', 'a:stream/conversations.json',
    'folder./conversations.json', 'folder /conversations.json',
  ])('rejects unsafe path %j', async (name) => {
    await expect(read(zip([{ name, content: '[]' }]))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it.each([0xa1ff, 0x21a4, 0x11a4])('rejects symlink/special entry mode %i', async (mode) => {
    await expect(read(zip([{ name: 'conversations.json', content: '[]', mode }])))
      .rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects duplicate normalized archive paths', async () => {
    await expect(read(zip([
      { name: 'conversations.json', content: '[]' },
      { name: 'CONVERSATIONS.JSON', content: '[]' },
    ]))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects nested archives even among ignored artifacts', async () => {
    await expect(read(zip([
      { name: 'conversations.json', content: '[]' },
      { name: 'nested.zip', content: 'not even a valid archive' },
    ]))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it.each([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    Buffer.from('Rar!\x1a\x07\x00', 'binary'),
    Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  ])('rejects archive magic in a misleading filename', async (magic) => {
    await expect(read(zip([
      { name: 'conversations.json', content: '[]' },
      { name: 'photo.bin', content: magic, deflate: true },
    ]))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it.each([
    ['encrypted', (b: Buffer, c: number) => { b.writeUInt16LE(0x801, c + 8); b.writeUInt16LE(0x801, 6); }],
    ['unsupported method', (b: Buffer, c: number) => { b.writeUInt16LE(12, c + 10); b.writeUInt16LE(12, 8); }],
    ['multidisk', (b: Buffer) => { b.writeUInt16LE(1, b.length - 18); }],
    ['ZIP64 count', (b: Buffer) => { b.writeUInt16LE(0xffff, b.length - 12); }],
    ['ZIP64 size', (b: Buffer, c: number) => { b.writeUInt32LE(0xffffffff, c + 24); }],
    ['invalid UTF-8 path', (b: Buffer, c: number) => { b[c + 46] = 0xff; b[30] = 0xff; }],
  ])('rejects %s safely', async (_label, mutate) => {
    const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
    (mutate as (b: Buffer, c: number) => void)(bytes, centralOffset(bytes));
    await expect(read(bytes)).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it.each([
    ['filename', (b: Buffer) => { b[30] = 'x'.charCodeAt(0); }],
    ['flags', (b: Buffer) => { b.writeUInt16LE(0, 6); }],
    ['method', (b: Buffer) => { b.writeUInt16LE(8, 8); }],
    ['uncompressed size', (b: Buffer) => { b.writeUInt32LE(1, 22); }],
    ['compressed size', (b: Buffer) => { b.writeUInt32LE(1, 18); }],
    ['checksum', (b: Buffer) => { b.writeUInt32LE(0, 14); }],
  ])('rejects mismatched local %s', async (_label, mutate) => {
    const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
    (mutate as (b: Buffer) => void)(bytes);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('rejects incorrect CRC even if both headers agree', async () => {
    const bytes = zip([{ name: 'conversations.json', content: '[]' }]);
    bytes.writeUInt32LE(0, 14);
    bytes.writeUInt32LE(0, centralOffset(bytes) + 16);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('rejects a forged data descriptor', async () => {
    const bytes = zip([{ name: 'conversations.json', content: '[]', descriptor: 'signed' }]);
    bytes.writeUInt32LE(0, centralOffset(bytes) - 4);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('rejects overlapping local entries', async () => {
    const embedded = zip([{ name: 'asset.bin', content: 'x' }]);
    const embeddedLocal = embedded.subarray(0, centralOffset(embedded));
    const bytes = zip([
      { name: 'conversations.json', content: Buffer.concat([Buffer.from('aa'), embeddedLocal]) },
      { name: 'asset.bin', content: 'x' },
    ]);
    const first = centralOffset(bytes);
    const second = first + 46 + Buffer.byteLength('conversations.json');
    bytes.writeUInt32LE(30 + Buffer.byteLength('conversations.json') + 2, second + 42);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it.each([
    ['input bytes', { maxInputBytes: 10 }],
    ['file bytes', { maxFileBytes: 1 }],
    ['total extracted bytes', { maxExtractedBytes: 3 }],
    ['file count', { maxFiles: 1 }],
    ['path depth', { maxPathDepth: 1 }],
  ])('enforces %s limits on ignored entries too', async (_label, override) => {
    await expect(read(zip([
      { name: 'conversations.json', content: '[]' },
      { name: 'deep/file.bin', content: 'xx' },
    ]), override as Partial<ImportLimits>)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('rejects decompression bombs before returning documents', async () => {
    await expect(read(zip([{ name: 'conversations.json', content: 'x'.repeat(100_000), deflate: true }]), { maxCompressionRatio: 10 }))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('bounds real decompressed output when both headers lie', async () => {
    const bytes = zip([{ name: 'conversations.json', content: 'x'.repeat(100_000), deflate: true }]);
    bytes.writeUInt32LE(2, 22);
    bytes.writeUInt32LE(2, centralOffset(bytes) + 24);
    await expect(read(bytes, { maxFileBytes: 20 })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('validates extracted size even when it remains below hard limits', async () => {
    const bytes = zip([{ name: 'conversations.json', content: '[1,2,3]', deflate: true }]);
    bytes.writeUInt32LE(2, 22);
    bytes.writeUInt32LE(2, centralOffset(bytes) + 24);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('honors cancellation before reading', async () => {
    const controller = new AbortController();
    controller.abort('private reason');
    await expect(read(zip([{ name: 'conversations.json', content: '[]' }]), {}, controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED', message: 'Import cancelled.' });
  });

  it('yields so cancellation during archive reading returns no documents', async () => {
    const controller = new AbortController();
    const task = read(zip(Array.from({ length: 20 }, (_, i) => ({ name: `conversations-${i}.json`, content: '[]' }))), {}, controller.signal);
    setImmediate(() => controller.abort());
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects trailing data after a deflate stream', async () => {
    const original = zip([{ name: 'conversations.json', content: '[]', deflate: true }]);
    const central = centralOffset(original);
    const bytes = Buffer.concat([original.subarray(0, central), Buffer.from('hidden trailing bytes'), original.subarray(central)]);
    const added = bytes.length - original.length;
    bytes.writeUInt32LE(original.readUInt32LE(18) + added, 18);
    bytes.writeUInt32LE(original.readUInt32LE(18) + added, central + added + 20);
    bytes.writeUInt32LE(central + added, bytes.length - 6);
    await expect(read(bytes)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('rejects file/directory aliases', async () => {
    await expect(read(zip([
      { name: 'folder', content: '' },
      { name: 'folder/', content: '', mode: 0x41ed },
      { name: 'conversations.json', content: '[]' },
    ]))).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('keeps validated bytes independent from caller mutation', async () => {
    const bytes = zip([{ name: 'conversations.json', content: '[]', deflate: true }]);
    const task = read(bytes);
    bytes.fill(0);
    await expect(task).resolves.toEqual({ documents: [Buffer.from('[]')], skippedArtifacts: 0 });
  });
});
