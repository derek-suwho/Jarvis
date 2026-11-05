import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('katex', () => { throw new Error('Math engine loaded before a formula needs it'); });

it('renders ordinary chat without loading the math engine', async () => {
  const { Markdown } = await import('../src/components/Markdown');
  expect(renderToStaticMarkup(createElement(Markdown, { text: 'Hello **world**' })))
    .toContain('<p>Hello <strong>world</strong></p>');
});
