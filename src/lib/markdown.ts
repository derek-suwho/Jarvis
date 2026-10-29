/**
 * Small Markdown subset for assistant replies: headings, paragraphs, lists,
 * quotes, rules, fenced code and GFM tables; inline code, bold, italic, links;
 * LaTeX math in \( \), $ $, \[ \] and $$ $$ (the delimiters ChatGPT and Claude emit).
 * Parsed to data so rendering never touches innerHTML (math goes through KaTeX).
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string; display: boolean }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  /** `open` marks a fence still being streamed (no closing fence yet). */
  | { kind: 'code'; lang: string; text: string; open?: true }
  | { kind: 'math'; tex: string; open?: true }
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'hr' };

// Groups: 2 code, 3 \(..\), 4 \[..\], 5 $$..$$, 6 $..$, 7/8 strong, 9 em, 10/11 link.
// A single-$ span must hug its content and not be followed by a digit, so "$5 and $10" stays text.
const INLINE =
  /(`+)([^`]+?)\1|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\$(?![\s$])([^$\n]*?[^\s\\$])\$(?!\d)|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

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
    else if (m[3] !== undefined || m[6] !== undefined) out.push({ kind: 'math', tex: (m[3] ?? m[6]).trim(), display: false });
    else if (m[4] !== undefined || m[5] !== undefined) out.push({ kind: 'math', tex: (m[4] ?? m[5]).trim(), display: true });
    else if (m[7] !== undefined || m[8] !== undefined) out.push({ kind: 'strong', children: parseInline(m[7] ?? m[8]) });
    else if (m[9] !== undefined) out.push({ kind: 'em', children: parseInline(m[9]) });
    else {
      const href = safeHref(m[11]);
      out.push(href ? { kind: 'link', href, children: parseInline(m[10]) } : { kind: 'text', text: m[0] });
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
/** A display-math line opener: `\[` or `$$`, optionally with the formula (and closer) on the same line. */
const MATH_OPEN = /^\s*(\\\[|\$\$)(.*)$/;
const MATH_CLOSE: Record<string, string> = { '\\[': '\\]', $$: '$$' };

function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => parseInline(c.trim()));
}

const startsBlock = (line: string, next = '') =>
  FENCE.test(line) ||
  MATH_OPEN.test(line) ||
  HEADING.test(line) ||
  HR.test(line) ||
  QUOTE.test(line) ||
  LIST.test(line) ||
  (line.includes('|') && TABLE_SEP.test(next));

/**
 * Reads display math starting at `lines[i]`; returns the block and the index after it, or null when
 * text follows the closer on its line (then the line is a paragraph with inline display math).
 */
function readMath(lines: string[], i: number, open: RegExpMatchArray): [Block, number] | null {
  const close = MATH_CLOSE[open[1]];
  const body: string[] = [];
  let rest = open[2];
  for (;;) {
    const end = rest.indexOf(close);
    if (end !== -1) {
      if (rest.slice(end + close.length).trim()) return null;
      body.push(rest.slice(0, end));
      return [{ kind: 'math', tex: body.join('\n').trim() }, i + 1];
    }
    body.push(rest);
    if (++i >= lines.length) return [{ kind: 'math', tex: body.join('\n').trim(), open: true }, i];
    rest = lines[i];
  }
}

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
      const open = i >= lines.length;
      i++;
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n'), ...(open ? { open: true as const } : {}) });
      continue;
    }
    const mathOpen = line.match(MATH_OPEN);
    const math = mathOpen && readMath(lines, i, mathOpen);
    if (math) {
      blocks.push(math[0]);
      i = math[1];
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
