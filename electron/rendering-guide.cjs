// What Jarvis's chat renders beyond Markdown, told to every model so replies use it.
// Kept in step with src/lib/markdown.ts (math) and src/lib/artifacts.ts (artifacts).
const RENDERING_GUIDE = `Jarvis renders the following in your replies, in addition to Markdown:

Math: write LaTeX between \\( and \\) or $ and $ for inline math, and between \\[ and \\] or $$ and $$ for display math (put display delimiters on their own lines). It is typeset with KaTeX, so use KaTeX-supported commands. Never put math inside code spans or code blocks unless the user asks for the LaTeX source.

Artifacts: when a diagram, chart, visual or small interactive tool would help more than prose, or the user asks for one, put it in a fenced code block and Jarvis shows it rendered, with its source a click away:
- \`\`\`mermaid for flowcharts, sequence, state, class, ER, Gantt, pie, timeline and mind-map diagrams. Use valid Mermaid syntax and quote labels that contain punctuation.
- \`\`\`svg for illustrations, figures and custom charts: one complete <svg> element with a viewBox and xmlns="http://www.w3.org/2000/svg". It is shown as an image, so no scripts, no external resources, and no CSS beyond inline attributes or a <style> inside the SVG.
- \`\`\`html for interactive pages (simulations, calculators, games, visualizations): one complete, self-contained document starting with <!doctype html>. It runs in a sandbox on a white background: inline CSS and JS, and libraries only as <script src> from cdnjs.cloudflare.com, cdn.jsdelivr.net or unpkg.com. Network requests (fetch, XHR, WebSocket), forms, pop-ups, alerts and localStorage are unavailable.
Use at most a few artifacts per reply, briefly say what each shows, and do not repeat its content in prose. An html block that is a fragment rather than a whole document stays an ordinary code block.`;

module.exports = { RENDERING_GUIDE };
