import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from '../src/lib/markdown';

describe('parseInline', () => {
  it('parses code, bold, italic and links', () => {
    expect(parseInline('a `x` **b** *c* [d](https://e.com)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://e.com', children: [{ kind: 'text', text: 'd' }] },
    ]);
  });

  it('keeps unsafe links as plain text', () => {
    expect(parseInline('[x](javascript:alert(1))')[0].kind).toBe('text');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  it('does not treat a lone asterisk list-like text as emphasis', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists and rules', () => {
    const blocks = parseMarkdown('# Title\n\nLine one\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n---');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'hr']);
    const [, , ul, ol] = blocks;
    expect(ul).toMatchObject({ ordered: false, items: [[{ text: 'a' }], [{ text: 'b' }]] });
    expect(ol).toMatchObject({ ordered: true, start: 1 });
  });

  it('keeps fenced code verbatim, including an unclosed fence', () => {
    expect(parseMarkdown('```ts\nconst a = **1**;\n```')).toEqual([{ kind: 'code', lang: 'ts', text: 'const a = **1**;' }]);
    expect(parseMarkdown('```\npartial')).toEqual([{ kind: 'code', lang: '', text: 'partial', open: true }]);
  });

  it('parses display math on its own lines in both delimiter styles', () => {
    expect(parseMarkdown('Projection\n\n\\[\nx^\\star=P_C(x_0)\n\\]\n\nAfter')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'Projection' }] },
      { kind: 'math', tex: 'x^\\star=P_C(x_0)' },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'After' }] },
    ]);
    expect(parseMarkdown('$$ a+b $$')).toEqual([{ kind: 'math', tex: 'a+b' }]);
  });

  it('ends a paragraph when display math starts', () => {
    expect(parseMarkdown('Intro\n\\[\nx\n\\]').map((b) => b.kind)).toEqual(['paragraph', 'math']);
  });

  it('marks display math that is still streaming', () => {
    expect(parseMarkdown('\\[\nx = ')).toEqual([{ kind: 'math', tex: 'x =', open: true }]);
  });
});

describe('inline math', () => {
  it('parses \\( \\) and $ $', () => {
    expect(parseInline('a point \\(x_0\\), and $C_i$.')).toEqual([
      { kind: 'text', text: 'a point ' },
      { kind: 'math', tex: 'x_0', display: false },
      { kind: 'text', text: ', and ' },
      { kind: 'math', tex: 'C_i', display: false },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps math intact where it contains emphasis characters', () => {
    expect(parseInline('\\(a*b*c\\)')).toEqual([{ kind: 'math', tex: 'a*b*c', display: false }]);
  });

  it('leaves prices alone', () => {
    expect(parseInline('costs $5 and $10')).toEqual([{ kind: 'text', text: 'costs $5 and $10' }]);
    expect(parseInline('$5,$10')).toEqual([{ kind: 'text', text: '$5,$10' }]);
  });

  it('does not parse math inside code spans', () => {
    expect(parseInline('`$x$`')).toEqual([{ kind: 'code', text: '$x$' }]);
  });

  it('parses tables and quotes', () => {
    const [table, quote] = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n> said');
    expect(table).toMatchObject({ kind: 'table', head: [[{ text: 'A' }], [{ text: 'B' }]], rows: [[[{ text: '1' }], [{ text: '2' }]]] });
    expect(quote).toMatchObject({ kind: 'quote', blocks: [{ kind: 'paragraph' }] });
  });

  it('ends a paragraph when a list starts', () => {
    expect(parseMarkdown('Intro:\n- one').map((b) => b.kind)).toEqual(['paragraph', 'list']);
  });
});
