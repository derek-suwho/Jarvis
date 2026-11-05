import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ copied: false, error: 'Could not copy. Try again or select the text to copy manually.' }));
vi.mock('../src/components/useCopy', () => ({ useCopy: () => [state.copied, vi.fn(), state.error] }));
import { MessageItem } from '../src/components/MessageItem';
import { Markdown } from '../src/components/Markdown';
import { Artifact } from '../src/components/Artifact';

it('announces clipboard failures beside every shipped copy surface and clears them on retry', () => {
  const surfaces = [
    ...(['user', 'assistant'] as const).map((role) => createElement(MessageItem, {
      message: { id: role, role, content: 'Response' }, streaming: false, isLast: true, busy: false,
    })),
    createElement(Markdown, { text: '```text\nExample\n```' }),
    createElement(Artifact, { kind: 'svg', text: '<svg/>', streaming: true }),
  ];
  for (const surface of surfaces) {
    state.error = 'Could not copy. Try again or select the text to copy manually.';
    const failed = renderToStaticMarkup(surface);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(state.error);
    state.error = '';
    expect(renderToStaticMarkup(surface)).not.toContain('Could not copy.');
  }
});


it('announces successful copying through a persistent live region on every shipped copy surface', () => {
  const surfaces = [
    ...(['user', 'assistant'] as const).map((role) => createElement(MessageItem, {
      message: { id: role, role, content: 'Response' }, streaming: false, isLast: true, busy: false,
    })),
    createElement(Markdown, { text: '```text\nExample\n```' }),
    createElement(Artifact, { kind: 'svg', text: '<svg/>', streaming: true }),
  ];
  const status = (markup: string) => markup.match(/<span[^>]*role="status"[^>]*>[\s\S]*?<\/span>/)?.[0];
  try {
    state.error = '';
    for (const surface of surfaces) {
      state.copied = false;
      const idle = status(renderToStaticMarkup(surface));
      expect(idle).toBeDefined();
      expect(idle).not.toContain('Copied to clipboard.');
      state.copied = true;
      const success = status(renderToStaticMarkup(surface));
      expect(success).toContain('aria-atomic="true"');
      expect(success).toContain('Copied to clipboard.');
      state.copied = false;
      expect(status(renderToStaticMarkup(surface))).toBe(idle);
    }
  } finally { state.copied = false; state.error = ''; }
});
