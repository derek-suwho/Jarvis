import { describe, expect, it } from 'vitest';
import type { Attachment, Message } from '../src/lib/chats';
import { buildReplyHistory, composeInstructions } from '../src/lib/replyContext';

function textFile(name: string, text: string): Attachment & { text: string } {
  return { id: name, name, size: text.length, type: 'text/plain', text };
}

describe('buildReplyHistory', () => {
  it('keeps native media in earlier turns for follow-ups without mutating stored attachments', () => {
    const image = { id: 'image', name: 'photo.png', type: 'image/png', size: 68, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2uoAAAAASUVORK5CYII=' };
    const pdf = { id: 'pdf', name: 'report.pdf', type: 'application/pdf', size: 16, data: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') };
    const history: Message[] = [
      { id: '1', role: 'user', content: 'Compare', attachments: [image, textFile('notes.txt', 'Check totals'), pdf] },
      { id: '2', role: 'assistant', content: 'They match' },
      { id: '3', role: 'user', content: 'Explain the chart' },
    ];
    const original = structuredClone(history);
    const result = buildReplyHistory(history, 'Be concise');
    expect(result[0]).toMatchObject({ media: [
      { name: 'photo.png', type: 'image/png', data: image.data },
      { name: 'report.pdf', type: 'application/pdf', data: pdf.data },
    ] });
    expect(result[0].content).toContain('Check totals');
    expect(result[0].content).toContain('Be concise');
    expect(result[2]).toEqual({ role: 'user', content: 'Explain the chart' });
    expect(history).toEqual(original);
  });

  it('allows switching a long saved conversation by retaining the latest 200 messages and instructions', () => {
    const history: Message[] = Array.from({ length: 203 }, (_, index) => ({
      id: String(index), role: index % 2 === 0 ? 'user' : 'assistant', content: `Turn ${index}`,
    }));
    const original = structuredClone(history);
    const result = buildReplyHistory(history, 'Keep project decisions');
    expect(result).toHaveLength(200);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Turn 3' });
    expect(result[1].content).toContain('Keep project decisions');
    expect(result[1].content).toContain('Turn 4');
    expect(result.at(-1)).toEqual({ role: 'user', content: 'Turn 202' });
    expect(result.filter((message) => message.content.includes('Keep project decisions'))).toHaveLength(1);
    expect(history).toEqual(original);
  });

  it('trims accumulated text before switching while retaining current input and instructions', () => {
    const history: Message[] = [
      { id: 'old', role: 'user', content: 'x'.repeat(250_000) },
      { id: 'reply', role: 'assistant', content: 'y'.repeat(150_000) },
      { id: 'recent', role: 'user', content: 'Recent decision' },
      { id: 'current', role: 'user', content: 'Continue', attachments: [textFile('notes.txt', 'Current notes')] },
    ];
    const original = structuredClone(history);
    const result = buildReplyHistory(history, 'Preserve decisions');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'assistant', content: 'y'.repeat(150_000) });
    expect(result[1].content).toContain('Preserve decisions');
    expect(result[1].content).toContain('Recent decision');
    expect(result[2].content).toContain('Continue');
    expect(result[2].content).toContain('Current notes');
    expect(result.filter((message) => message.content.includes('Preserve decisions'))).toHaveLength(1);
    expect(history).toEqual(original);
  });

  it('trims aggregate media before switching while preserving current attachments and instructions', () => {
    const data = Buffer.from('%PDF-1.4\n' + ' '.repeat(8 * 1024 * 1024) + '\n%%EOF').toString('base64');
    const attachment = { id: 'pdf', name: 'report.pdf', type: 'application/pdf', size: 8 * 1024 * 1024, data };
    const history: Message[] = [
      { id: 'old', role: 'user', content: 'Old report', attachments: [attachment] },
      { id: 'reply', role: 'assistant', content: 'Previous summary' },
      { id: 'current', role: 'user', content: 'Compare current report', attachments: [attachment] },
    ];
    const original = structuredClone(history);
    const result = buildReplyHistory(history, 'Cite the report');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Previous summary' });
    expect(result[1].content).toContain('Cite the report');
    expect(result[1].content).toContain('Compare current report');
    expect(result[1].media).toEqual([{ name: attachment.name, type: attachment.type, data }]);
    expect(history).toEqual(original);
  }, 20_000);

  it('rejects oversized current input before any transport starts', () => {
    expect(() => buildReplyHistory([{ id: '1', role: 'user', content: 'x'.repeat(400001) }])).toThrow(/too long/i);
    const data = Buffer.from('%PDF-1.4\n' + ' '.repeat(8 * 1024 * 1024) + '\n%%EOF').toString('base64');
    const attachment = { id: 'pdf', name: 'report.pdf', type: 'application/pdf', size: 8 * 1024 * 1024, data };
    expect(() => buildReplyHistory([{
      id: 'current', role: 'user', content: 'Analyze', attachments: [attachment, attachment],
    }])).toThrow(/10 MB/i);
  }, 20_000);

  it('preserves conversation order and omits failed responses', () => {
    const history: Message[] = [
      { id: '1', role: 'user', content: 'First question' },
      { id: '2', role: 'assistant', content: 'Network error', error: true },
      { id: '3', role: 'assistant', content: 'First answer', model: 'test' },
      { id: '4', role: 'user', content: 'Follow-up' },
    ];
    expect(buildReplyHistory(history)).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up' },
    ]);
  });

  it('sends full attachment text in every message that owns a file', () => {
    const completeText = `Quarter one\n${'Revenue 123; expenses 45.\n'.repeat(1500)}End of report`;
    const history: Message[] = [
      { id: '1', role: 'user', content: 'Read the report', attachments: [textFile('report.txt', completeText)] },
      { id: '2', role: 'assistant', content: 'Result', attachments: [textFile('answer.md', '# Answer\n78')] },
      { id: '3', role: 'user', content: 'Compare', attachments: [textFile('notes.csv', 'year,total\n2026,987')] },
    ];
    const result = buildReplyHistory(history);
    expect(result).toHaveLength(3);
    expect(result[0].content).toContain('Read the report');
    expect(result[0].content).toContain('report.txt');
    expect(result[0].content).toContain(completeText);
    expect(result[1].content).toContain('# Answer\n78');
    expect(result[2].content).toContain('year,total\n2026,987');
    expect(result[2].content).not.toContain(completeText);
  });

  it('inserts supplied instructions once into the first user message', () => {
    const history: Message[] = [
      { id: '0', role: 'assistant', content: 'Welcome' },
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'user', content: 'Another question' },
    ];
    const result = buildReplyHistory(history, 'Use short sentences.');
    expect(result[0]).toEqual({ role: 'assistant', content: 'Welcome' });
    expect(result[1].content).toContain('Use short sentences.');
    expect(result[1].content).toContain('Hello');
    expect(result[2]).toEqual({ role: 'user', content: 'Another question' });
    expect(result.filter((message) => message.content.includes('Use short sentences.'))).toHaveLength(1);
  });

  it('does not mutate saved messages or accumulate context on repeated sends', () => {
    const history: Message[] = [
      { id: '1', role: 'user', content: 'Summarize', attachments: [textFile('notes.txt', 'Full notes')] },
    ];
    const original = structuredClone(history);
    const first = buildReplyHistory(history, 'Be concise.');
    const second = buildReplyHistory(history, 'Be concise.');
    expect(first).toHaveLength(1);
    expect(history).toEqual(original);
    expect(second).toEqual(first);
    expect(first[0]).not.toBe(history[0]);
  });

  it('fails explicitly when a saved attachment has no readable content', () => {
    const history: Message[] = [{
      id: '1', role: 'user', content: 'Analyze this',
      attachments: [{ id: 'file', name: 'legacy.pdf', size: 100, type: 'application/pdf' }],
    }];
    expect(() => buildReplyHistory(history)).toThrow(/legacy\.pdf/);
    expect(() => buildReplyHistory(history)).toThrow(/text|contents|content/i);
  });

  it('ignores attachments on failed messages excluded from context', () => {
    const history: Message[] = [
      { id: '0', role: 'assistant', error: true, content: 'Failed', attachments: [{ id: 'x', name: 'missing', size: 1, type: '' }] },
      { id: '1', role: 'user', content: 'Retry' },
    ];
    expect(buildReplyHistory(history)).toEqual([{ role: 'user', content: 'Retry' }]);
  });

  it('leaves plain text alone when instructions are blank', () => {
    expect(buildReplyHistory([{ id: '1', role: 'user', content: '  Preserve whitespace\n' }], '  '))
      .toEqual([{ role: 'user', content: '  Preserve whitespace\n' }]);
  });
});

describe('composeInstructions', () => {
  it('preserves both scopes and explains project precedence', () => {
    const result = composeInstructions('Use a casual voice.', 'Use a formal voice.');
    expect(result).toContain('Use a casual voice.');
    expect(result).toContain('Use a formal voice.');
    expect(result).toMatch(/project instructions take precedence over personal preferences/i);
  });

  it('omits blank scopes and has no context when both are blank', () => {
    expect(composeInstructions('  ', '\n')).toBe('');
    expect(composeInstructions('  Be concise.  ')).toContain('Be concise.');
    expect(composeInstructions('', '  Cite sources.  ')).toContain('Cite sources.');
    expect(composeInstructions('Be concise.')).not.toMatch(/project instructions:/i);
    expect(composeInstructions('', 'Cite sources.')).not.toMatch(/personal preferences:/i);
  });
});
