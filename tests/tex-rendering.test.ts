import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import TeX from '../src/components/TeX';

it('renders loaded math accessibly and keeps untrusted TeX links disabled', () => {
  const html = renderToStaticMarkup(createElement(TeX, { tex: 'x^2', display: true }));
  expect(html).toContain('class="md-math-display"');
  expect(html).toContain('<math');
  expect(html).toContain('katex-html');
  const untrusted = renderToStaticMarkup(createElement(TeX, {
    tex: '\\href{https://example.com}{click}', display: false,
  }));
  expect(untrusted).not.toContain('<a ');
});
