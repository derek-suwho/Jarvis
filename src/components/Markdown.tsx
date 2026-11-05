import { Fragment, Suspense, lazy, useMemo } from 'react';
import type { Block, Inline } from '../lib/markdown';
import { parseMarkdown } from '../lib/markdown';
import { artifactKind } from '../lib/artifacts';
import { Artifact } from './Artifact';
import { useCopy } from './useCopy';
import { CheckIcon, CopyIcon } from './Icons';

function UnavailableTeX({ tex, display }: { tex: string; display: boolean }) {
  const Tag = display ? 'div' : 'span';
  return <Tag className={display ? 'md-math-display' : 'md-math'}>
    <span className="sr-only">Math rendering unavailable; showing source.</span>
    {tex}
  </Tag>;
}

const LazyTeX = lazy(() => import('./TeX').catch(() => ({ default: UnavailableTeX })));

function TeX({ tex, display }: { tex: string; display: boolean }) {
  const Tag = display ? 'div' : 'span';
  return (
    <Suspense fallback={<Tag className={display ? 'md-math-display' : 'md-math'}>{tex}</Tag>}>
      <LazyTeX tex={tex} display={display} />
    </Suspense>
  );
}

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((n, i) => {
        switch (n.kind) {
          case 'text':
            return <Fragment key={i}>{n.text}</Fragment>;
          case 'code':
            return <code key={i}>{n.text}</code>;
          case 'math':
            return <TeX key={i} tex={n.tex} display={n.display} />;
          case 'strong':
            return (
              <strong key={i}>
                <Inlines items={n.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inlines items={n.children} />
              </em>
            );
          case 'link':
            return (
              <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">
                <Inlines items={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, copy, copyError] = useCopy();
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'text'}</span>
        <button onClick={() => copy(text)}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError && <p className="task-error" role="alert">{copyError}</p>}
      <span className="sr-only" role="status" aria-atomic={true}>{copied ? 'Copied to clipboard.' : ''}</span>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'code': {
            const kind = artifactKind(b.lang, b.text);
            return kind ? (
              <Artifact key={i} kind={kind} text={b.text} streaming={!!b.open} />
            ) : (
              <CodeBlock key={i} lang={b.lang} text={b.text} />
            );
          }
          case 'math':
            // A formula still streaming in shows as its source until the closer arrives.
            return b.open ? (
              <p key={i} className="md-math-pending">
                {b.tex}
              </p>
            ) : (
              <TeX key={i} tex={b.tex} display />
            );
          case 'heading': {
            const H = `h${Math.min(b.level + 1, 6)}` as 'h2';
            return (
              <H key={i}>
                <Inlines items={b.inlines} />
              </H>
            );
          }
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines items={b.inlines} />
              </p>
            );
          case 'list': {
            const items = b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} />
              </li>
            ));
            return b.ordered ? (
              <ol key={i} start={b.start}>
                {items}
              </ol>
            ) : (
              <ul key={i}>{items}</ul>
            );
          }
          case 'quote':
            return (
              <blockquote key={i}>
                <Blocks blocks={b.blocks} />
              </blockquote>
            );
          case 'table':
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>
                          <Inlines items={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>
                            <Inlines items={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={i} />;
        }
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="markdown">
      <Blocks blocks={blocks} />
    </div>
  );
}
