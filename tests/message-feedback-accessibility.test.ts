import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageItem } from '../src/components/MessageItem';

it.each([undefined, 'up', 'down'] as const)('exposes the selected response feedback to assistive technology (%s)', (feedback) => {
  const markup = renderToStaticMarkup(createElement(MessageItem, {
    message: { id: 'reply', role: 'assistant', content: 'A response', feedback },
    streaming: false, isLast: true, busy: false, onFeedback: vi.fn(),
  }));
  const button = (label: string) => markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
  expect(button('Good response')).toContain(`aria-pressed="${feedback === 'up'}"`);
  expect(button('Bad response')).toContain(`aria-pressed="${feedback === 'down'}"`);
  expect(button('Copy')).not.toContain('aria-pressed');
});
