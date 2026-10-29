import { describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_ACCEPT, MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES, toAttachment, vetFiles } from '../src/lib/attachments';

describe('text attachments', () => {
  it('reads Markdown, code, and CSV contents for provider context', async () => {
    for (const name of ['notes.md', 'main.ts', 'data.csv']) {
      const attachment = await toAttachment(new File(['hello\nworld'], name));
      expect(attachment).toMatchObject({ name, text: 'hello\nworld', size: 11 });
      expect(attachment.id).toBeTruthy();
      expect(attachment.preview).toBeUndefined();
    }
    expect(ATTACHMENT_ACCEPT).toContain('.tsx');
    expect(ATTACHMENT_ACCEPT).toContain('image/png');
    await expect(toAttachment(new File(['name,value\ncount,2'], 'data.csv', { type: 'application/vnd.ms-excel' })))
      .resolves.toMatchObject({ text: 'name,value\ncount,2' });
  });

  it('rejects unsupported files before reading with an actionable error', async () => {
    for (const [name, type] of [['drawing.svg', 'image/svg+xml'], ['book.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
      const file = new File(['contents'], name, { type });
      const read = vi.spyOn(file, 'arrayBuffer');
      await expect(toAttachment(file)).rejects.toThrow(/isn't supported/);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('rejects binary contents, invalid UTF-8, blank text, and unreadable files', async () => {
    await expect(toAttachment(new File(['a\0b'], 'binary.txt'))).rejects.toThrow('binary data');
    await expect(toAttachment(new File([new Uint8Array([0xff])], 'invalid.txt'))).rejects.toThrow('UTF-8');
    await expect(toAttachment(new File([' \n\t'], 'blank.txt'))).rejects.toThrow('has no text');
    const file = new File(['abc'], 'missing.txt');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('permission denied'));
    await expect(toAttachment(file)).rejects.toThrow("Couldn't read missing.txt");
  });

  it('enforces per-file and aggregate byte limits without rejecting valid neighbors', () => {
    const file = (name: string, size: number) => ({ name, size, type: 'text/plain' });
    const result = vetFiles([file('big.txt', MAX_FILE_BYTES + 1), file('ok.txt', 10)], 0);
    expect(result.accepted.map((item) => item.name)).toEqual(['ok.txt']);
    expect(result.errors[0]).toContain('128 KB');
    const total = vetFiles([file('over.txt', 11), file('fits.txt', 10)], 1, MAX_TOTAL_FILE_BYTES - 10);
    expect(total.accepted.map((item) => item.name)).toEqual(['fits.txt']);
    expect(total.errors[0]).toContain('10.0 MB');
  });
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2uoAAAAASUVORK5CYII=';
const PDF = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';

describe('media attachments', () => {
  it('retains original image bytes and a thumbnail, including files without a MIME type', async () => {
    const file = new File([Buffer.from(PNG, 'base64')], 'screen.PNG');
    const result = await toAttachment(file);
    expect(result).toMatchObject({ name: 'screen.PNG', type: 'image/png', data: PNG, preview: `data:image/png;base64,${PNG}` });
    expect(result.text).toBeUndefined();
  });

  it('retains PDF bytes for native analysis instead of decoding binary as text', async () => {
    const result = await toAttachment(new File([PDF], 'report.pdf', { type: 'application/pdf' }));
    expect(result).toMatchObject({ name: 'report.pdf', type: 'application/pdf', data: Buffer.from(PDF).toString('base64') });
    expect(result.preview).toBeUndefined();
    expect(result.text).toBeUndefined();
    expect(ATTACHMENT_ACCEPT).toContain('.pdf');
  });

  it('accepts supported signatures and normalizes JPEG aliases', async () => {
    const fixtures = [
      ['photo.jpg', 'image/jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), 'image/jpeg'],
      ['motion.gif', 'image/gif', Buffer.from('GIF89a123456'), 'image/gif'],
      ['photo.webp', 'image/webp', Buffer.from('RIFF1234WEBP1234'), 'image/webp'],
    ] as const;
    for (const [name, type, bytes, expectedType] of fixtures) {
      await expect(toAttachment(new File([bytes], name, { type })))
        .resolves.toMatchObject({ type: expectedType, data: bytes.toString('base64') });
    }
  });

  it('rejects corrupt, truncated, and MIME-mismatched files with readable errors', async () => {
    for (const file of [
      new File(['not a PDF'], 'broken.pdf', { type: 'application/pdf' }),
      new File(['%PDF-1.7\ntruncated'], 'broken.pdf'),
      new File([Buffer.from(PNG, 'base64')], 'fake.jpg', { type: 'image/jpeg' }),
      new File(['not a PNG'], 'broken.png'),
    ]) {
      await expect(toAttachment(file)).rejects.toThrow(/damaged|match|valid/i);
    }
  });

  it('uses media-specific limits and rejects empty media before reading', () => {
    const result = vetFiles([
      { name: 'large.png', size: 3 * 1024 * 1024 + 1, type: 'image/png' },
      { name: 'report.pdf', size: 4 * 1024 * 1024, type: 'application/pdf' },
      { name: 'empty.jpg', size: 0, type: 'image/jpeg' },
    ], 0);
    expect(result.accepted.map(({ name }) => name)).toEqual(['report.pdf']);
    expect(result.errors.join(' ')).toContain('3.0 MB');
    expect(result.errors.join(' ')).toContain('empty.jpg is empty');
  });

  it('rejects filenames the provider cannot accept before consuming a draft', async () => {
    const file = new File([Buffer.from(PNG, 'base64')], 'broken\nname.png', { type: 'image/png' });
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(toAttachment(file)).rejects.toThrow(/Rename the file/);
    expect(read).not.toHaveBeenCalled();
  });
});
