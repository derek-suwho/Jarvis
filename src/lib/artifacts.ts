/**
 * Artifacts: fenced blocks a reply asks Jarvis to render instead of print — Mermaid diagrams, SVG
 * images and self-contained HTML pages. Like Claude's artifacts, they render in isolation from the app:
 * SVG and Mermaid as images (no scripts), HTML in a sandboxed iframe with an opaque origin.
 */
export type ArtifactKind = 'mermaid' | 'svg' | 'html';

export const ARTIFACT_LABEL: Record<ArtifactKind, string> = { mermaid: 'Diagram', svg: 'Image', html: 'Page' };

/**
 * Which artifact a fenced block is, if any. HTML renders only as a whole document, so a snippet
 * shown to explain markup stays code.
 */
export function artifactKind(lang: string, text: string): ArtifactKind | null {
  const l = lang.toLowerCase();
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (l === 'mermaid') return 'mermaid';
  if (l === 'svg' || ((l === 'xml' || l === 'html') && head.startsWith('<svg'))) return 'svg';
  if (l === 'html' && (head.startsWith('<!doctype html') || head.startsWith('<html'))) return 'html';
  return null;
}

/** SVG markup as an image URL; an <img> never runs the SVG's scripts or loads its external resources. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Message type the HTML frame posts to report its content height. */
export const HEIGHT_MESSAGE = 'jarvis-artifact-height';

/**
 * Pages may load libraries from the common CDNs and show images, but cannot make requests
 * (fetch, XHR, WebSocket), submit forms or embed frames.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com",
  'font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net',
  'img-src data: blob: https:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const REPORT_HEIGHT = `<script>(() => {
  const post = () => parent.postMessage({ type: '${HEIGHT_MESSAGE}', height: document.documentElement.scrollHeight }, '*');
  addEventListener('load', post);
  new ResizeObserver(post).observe(document.documentElement);
})();</script>`;

/**
 * The page as the frame's srcdoc. The CSP meta comes right after the doctype so the parser places it
 * in <head> before any of the page's own content; the height reporter runs alongside the page.
 */
export function htmlDocument(html: string): string {
  const body = html.trimStart().replace(/^<!doctype html[^>]*>/i, '');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">${REPORT_HEIGHT}${body}`;
}
