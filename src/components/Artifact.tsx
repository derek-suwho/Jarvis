import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArtifactKind } from '../lib/artifacts';
import { ARTIFACT_LABEL, HEIGHT_MESSAGE, htmlDocument, svgDataUrl } from '../lib/artifacts';
import { useCopy } from './useCopy';
import { CheckIcon, CollapseIcon, CopyIcon, ExpandIcon } from './Icons';
import './Artifact.css';

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Renders Mermaid source to SVG markup. Mermaid is large, so it loads on the first diagram. */
async function renderMermaid(id: string, source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: prefersDark() ? 'dark' : 'default',
    // Plain SVG text (no HTML labels), so the diagram also draws correctly as an <img>.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  });
  const { svg } = await mermaid.render(id, source);
  return svg;
}

function MermaidPreview({ source }: { source: string }) {
  const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    renderMermaid(id, source).then(
      (out) => live && setSvg(out),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'This diagram could not be drawn.'),
    );
    return () => {
      live = false;
    };
  }, [id, source]);

  if (error) return <p className="artifact-error">Couldn’t draw this diagram: {error}</p>;
  if (!svg) return <div className="artifact-loading">Drawing diagram…</div>;
  return <img className="artifact-image" src={svgDataUrl(svg)} alt="Diagram" />;
}

function HtmlPreview({ html, fill }: { html: string; fill: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== HEIGHT_MESSAGE) return;
      const h = Number(e.data.height);
      if (Number.isFinite(h)) setHeight(Math.min(Math.max(h, 120), 720));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      className="artifact-frame"
      title="Page preview"
      // Scripts run, but with an opaque origin: no access to Jarvis, its storage or its bridge.
      sandbox="allow-scripts"
      srcDoc={htmlDocument(html)}
      style={fill ? undefined : { height }}
    />
  );
}

interface Props {
  kind: ArtifactKind;
  text: string;
  /** The fence hasn't closed yet; show the source as it arrives. */
  streaming: boolean;
}

export function Artifact({ kind, text, streaming }: Props) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [expanded, setExpanded] = useState(false);
  const [copied, copy] = useCopy();
  const showCode = streaming || view === 'code';

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const card = (
    <div className={`artifact${expanded ? ' expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}>
      <div className="md-code-bar artifact-bar">
        <span className="artifact-title">
          {ARTIFACT_LABEL[kind]}
          {streaming && <span className="artifact-status">Writing…</span>}
        </span>
        <span className="artifact-actions">
          {!streaming && (
            <span className="artifact-tabs" role="tablist" aria-label="Artifact view">
              <button role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>
                Preview
              </button>
              <button role="tab" aria-selected={view === 'code'} onClick={() => setView('code')}>
                Code
              </button>
            </span>
          )}
          <button onClick={() => copy(text)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {!streaming && (
            <button
              onClick={() => setExpanded((x) => !x)}
              title={expanded ? 'Close full view' : 'Open full view'}
              aria-label={expanded ? 'Close full view' : 'Open full view'}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          )}
        </span>
      </div>
      {showCode ? (
        <pre>
          <code>{text}</code>
        </pre>
      ) : (
        <div className="artifact-preview">
          {kind === 'mermaid' && <MermaidPreview source={text} />}
          {kind === 'svg' && <img className="artifact-image" src={svgDataUrl(text)} alt="Image" />}
          {kind === 'html' && <HtmlPreview html={text} fill={expanded} />}
        </div>
      )}
    </div>
  );

  if (!expanded) return card;
  return (
    <>
      <div className="artifact-placeholder">{ARTIFACT_LABEL[kind]} open in full view</div>
      {createPortal(card, document.body)}
    </>
  );
}
