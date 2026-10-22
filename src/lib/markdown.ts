/**
 * Small Markdown subset for assistant replies: headings, paragraphs, lists,
 * quotes, rules, fenced code and GFM tables; inline code, bold, italic, links.
 * Parsed to data so rendering never touches innerHTML.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'hr' };

const INLINE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Only web and mail links are rendered as anchors. */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: src.slice(last, i) });
    if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ kind: 'strong', children: parseInline(m[3] ?? m[4]) });
    else if (m[5] !== undefined) out.push({ kind: 'em', children: parseInline(m[5]) });
    else {
      const href = safeHref(m[7]);
      out.push(href ? { kind: 'link', href, children: parseInline(m[6]) } : { kind: 'text', text: m[0] });
    }
    last = i + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const LIST = /^\s*([-*+]|(\d+)[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => parseInline(c.trim()));
}

const startsBlock = (line: string, next = '') =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || (line.includes('|') && TABLE_SEP.test(next));

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end, which is what a still-streaming reply looks like.
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      blocks.push({ kind: 'quote', blocks: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    const item = line.match(LIST);
    if (item) {
      const ordered = item[2] !== undefined;
      const items: Inline[][] = [];
      let text: string | null = null;
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m && (m[2] !== undefined) === ordered) {
          if (text !== null) items.push(parseInline(text));
          text = m[3];
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && text !== null) {
          text += ' ' + lines[i].trim(); // continuation line
        } else break;
        i++;
      }
      if (text !== null) items.push(parseInline(text));
      blocks.push({ kind: 'list', ordered, start: ordered ? Number(item[2]) : 1, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++]);
    blocks.push({ kind: 'paragraph', inlines: parseInline(para.join('\n')) });
  }
  return blocks;
}
