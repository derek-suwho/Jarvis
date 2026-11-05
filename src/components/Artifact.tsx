import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useDialog } from './useDialog';
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
    setSvg(null);
    setError(null);
    renderMermaid(id, source).then(
      (out) => live && setSvg(out),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'This diagram could not be drawn.'),
    );
    return () => {
      live = false;
    };
  }, [id, source]);

  if (error) return <p className="artifact-error" role="alert">Couldn’t draw this diagram: {error}</p>;
  if (!svg) return <div className="artifact-loading" role="status">Drawing diagram…</div>;
  return <img className="artifact-image" src={svgDataUrl(svg)} alt="Diagram" onError={() => setError('The diagram image could not be displayed. Open Code to inspect or copy the source.')} />;
}

function SvgPreview({ source }: { source: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (failedSource === source) {
    return <p className="artifact-error" role="alert">Couldn’t display this image. Open Code to inspect or copy the SVG source.</p>;
  }
  return <img className="artifact-image" src={svgDataUrl(source)} alt="Image" onError={() => setFailedSource(source)} />;
}

function HtmlPreview({ html, fill }: { html: string; fill: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [loadedHtml, setLoadedHtml] = useState<string | null>(null);
  const [failedHtml, setFailedHtml] = useState<string | null>(null);
  const failed = failedHtml === html;
  const loading = loadedHtml !== html && !failed;

  useEffect(() => {
    setHeight(360);
    setLoadedHtml(null);
    setFailedHtml(null);
  }, [html]);

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
    <>
      {loading && <div className="artifact-loading" role="status">Loading page preview…</div>}
      {failed && <p className="artifact-error" role="alert">Couldn’t load this page preview. Open Code to inspect or copy the HTML source.</p>}
      <iframe
        ref={frame}
        aria-busy={loading}
        onLoad={() => setLoadedHtml(html)}
        onError={() => setFailedHtml(html)}
        className="artifact-frame"
        title="Page preview"
        // Scripts run, but with an opaque origin: no access to Jarvis, its storage or its bridge.
        sandbox="allow-scripts"
        srcDoc={htmlDocument(html)}
        style={fill ? undefined : { height }}
      />
    </>
  );
}

interface Props {
  kind: ArtifactKind;
  text: string;
  /** The fence hasn't closed yet; show the source as it arrives. */
  streaming: boolean;
}

function ExpandedArtifact({ card, onClose }: { card: ReactElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return cloneElement(card, { ref, tabIndex: -1 });
}

export function Artifact({ kind, text, streaming }: Props) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const restoreExpansionFocus = useRef(false);
  const closeExpanded = () => {
    restoreExpansionFocus.current = true;
    setExpanded(false);
  };
  useEffect(() => {
    if (!expanded && restoreExpansionFocus.current) {
      restoreExpansionFocus.current = false;
      expandButton.current?.focus();
    }
  }, [expanded]);
  const [copied, copy, copyError] = useCopy();
  const showCode = streaming || view === 'code';
  const viewId = useId();
  const panelProps = streaming ? {} : {
    id: `${viewId}-panel`,
    role: 'tabpanel',
    'aria-labelledby': `${viewId}-${view}`,
    tabIndex: 0,
  };
  const previewTab = useRef<HTMLButtonElement>(null);
  const codeTab = useRef<HTMLButtonElement>(null);
  const onTabKey = (event: ReactKeyboardEvent, current: 'preview' | 'code') => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    let next: 'preview' | 'code';
    if (event.key === 'Home') next = 'preview';
    else if (event.key === 'End') next = 'code';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = current === 'preview' ? 'code' : 'preview';
    else return;
    event.preventDefault();
    setView(next);
    (next === 'preview' ? previewTab : codeTab).current?.focus();
  };

  const card = (
    <div className={`artifact${expanded ? ' expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? ARTIFACT_LABEL[kind] : undefined}>
      <div className="md-code-bar artifact-bar">
        <span className="artifact-title">
          {ARTIFACT_LABEL[kind]}
          {streaming && <span className="artifact-status">Writing…</span>}
        </span>
        <span className="artifact-actions">
          {!streaming && (
            <span className="artifact-tabs" role="tablist" aria-label="Artifact view">
              <button ref={previewTab} id={`${viewId}-preview`} aria-controls={`${viewId}-panel`} role="tab" tabIndex={view === 'preview' ? 0 : -1} aria-selected={view === 'preview'} onKeyDown={(event) => onTabKey(event, 'preview')} onClick={() => setView('preview')}>
                Preview
              </button>
              <button ref={codeTab} id={`${viewId}-code`} aria-controls={`${viewId}-panel`} role="tab" tabIndex={view === 'code' ? 0 : -1} aria-selected={view === 'code'} onKeyDown={(event) => onTabKey(event, 'code')} onClick={() => setView('code')}>
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
              ref={expanded ? undefined : expandButton}
              onClick={expanded ? closeExpanded : () => setExpanded(true)}
              title={expanded ? 'Close full view' : 'Open full view'}
              aria-label={expanded ? 'Close full view' : 'Open full view'}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          )}
        </span>
      </div>
      {copyError && <p className="task-error" role="alert">{copyError}</p>}
      <span className="sr-only" role="status" aria-atomic={true}>{copied ? 'Copied to clipboard.' : ''}</span>
      {showCode ? (
        <pre {...panelProps}>
          <code>{text}</code>
        </pre>
      ) : (
        <div className="artifact-preview" {...panelProps}>
          {kind === 'mermaid' && <MermaidPreview source={text} />}
          {kind === 'svg' && <SvgPreview source={text} />}
          {kind === 'html' && <HtmlPreview html={text} fill={expanded} />}
        </div>
      )}
    </div>
  );

  if (!expanded) return card;
  return (
    <>
      <div className="artifact-placeholder">{ARTIFACT_LABEL[kind]} open in full view</div>
      {createPortal(<ExpandedArtifact card={card} onClose={closeExpanded} />, document.body)}
    </>
  );
}
