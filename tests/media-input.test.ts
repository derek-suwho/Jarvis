import { describe, expect, it } from 'vitest';
import mediaInput from '../electron/media-input.cjs';

const png = Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64');
const pdf = Buffer.from('%PDF-1.7\nbody\n%%EOF').toString('base64');
const file = (extra: object = {}) => ({ name: 'image.png', type: 'image/png', data: png, ...extra });
const message = (media: object[], extra: object = {}) => ({ role: 'user', content: 'Analyze', media, ...extra });

describe('provider media validation', () => {
  it('sanitizes messages and media while preserving exact bytes', () => {
    const result = mediaInput.validateMessages([
      message([file({ extra: 'ignored' }), file({ name: 'report.pdf', type: 'application/pdf', data: pdf })], { extra: 'ignored' }),
      { role: 'assistant', content: 'Understood', extra: 'ignored' },
    ]);
    expect(result).toEqual([
      message([file(), file({ name: 'report.pdf', type: 'application/pdf', data: pdf })]),
      { role: 'assistant', content: 'Understood' },
    ]);
  });

  it('accepts canonical JPEG, GIF, and WebP signatures', () => {
    for (const [type, bytes] of [
      ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
      ['image/gif', Buffer.from('GIF89a')],
      ['image/webp', Buffer.from('RIFF0000WEBP')],
    ] as const) {
      expect(() => mediaInput.validateMessages([message([file({ type, data: bytes.toString('base64') })])])).not.toThrow();
    }
  });

  it('rejects invalid names, sources, types, signatures, and base64', () => {
    for (const invalid of [
      { name: '' }, { name: ' '.repeat(2) }, { name: 'a'.repeat(256) }, { name: 'bad\0name' },
      { type: 'image/svg+xml' }, { data: '' }, { data: `${png}\n` }, { data: png.slice(0, -1) },
      { data: 'https://example.com/image.png' }, { data: Buffer.from('not an image').toString('base64') },
      { type: 'image/jpeg' }, { type: 'application/pdf', data: Buffer.from('%PDF-1.7\ntruncated').toString('base64') },
    ]) {
      expect(() => mediaInput.validateMessages([message([file(invalid)])])).toThrow();
    }
    // Non-zero unused padding bits decode to the same bytes but are not canonical base64.
    expect(() => mediaInput.validateMessages([message([file({ data: `${png.slice(0, -3)}B==` })])])).toThrow();
    const wrongSignature = Buffer.from(Buffer.from('GIF89a').map((byte) => byte | 0x80)).toString('base64');
    expect(() => mediaInput.validateMessages([message([file({ type: 'image/gif', data: wrongSignature })])])).toThrow();
    expect(() => mediaInput.validateMessages([message([file()], { role: 'assistant' })])).toThrow();
    expect(() => mediaInput.validateMessages([message([] , { media: 'bad' })])).toThrow();
  });

  it('bounds media count, individual sizes, aggregate raw bytes, and serialized history', () => {
    const large = (type: string, size: number) => {
      const bytes = Buffer.alloc(size);
      if (type === 'application/pdf') {
        bytes.write('%PDF-1.7');
        bytes.write('%%EOF', size - 5);
      } else Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
      return file({ type, data: bytes.toString('base64') });
    };
    expect(() => mediaInput.validateMessages([message(Array.from({ length: 11 }, () => file()))])).toThrow();
    expect(() => mediaInput.validateMessages([message([large('image/png', 3 * 1024 * 1024 + 1)])])).toThrow();
    expect(() => mediaInput.validateMessages([message([large('application/pdf', 10 * 1024 * 1024 + 1)])])).toThrow();
    const sixMiB = large('application/pdf', 6 * 1024 * 1024);
    expect(() => mediaInput.validateMessages([message([sixMiB, sixMiB])])).toThrow();
    expect(() => mediaInput.validateMessages([message([sixMiB]), message([sixMiB]), message([sixMiB])])).toThrow(/too large/i);
    const nearBudget = large('application/pdf', 7.25 * 1024 * 1024);
    const nearLimit = (text: string) => [message([nearBudget], { content: text }), message([nearBudget], { content: '' })];
    expect(() => mediaInput.validateMessages(nearLimit('a'.repeat(400_000)))).not.toThrow();
    expect(() => mediaInput.validateMessages(nearLimit('文'.repeat(400_000)))).toThrow(/too large/i);
  });

  it('retains text and message count limits independently from media bytes', () => {
    expect(() => mediaInput.validateMessages([message([file()], { content: 'a'.repeat(400_001) })])).toThrow(/too long/i);
    expect(() => mediaInput.validateMessages(Array.from({ length: 201 }, () => message([])))).toThrow();
    expect(mediaInput.validateMessages([{ role: 'user', content: 'plain', media: [] }])).toEqual([{ role: 'user', content: 'plain' }]);
  });
});
