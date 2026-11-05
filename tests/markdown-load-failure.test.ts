import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';

vi.mock('../src/components/TeX', () => { throw new Error('Chunk unavailable'); });
import { Markdown } from '../src/components/Markdown';

it('preserves escaped formula source and surrounding chat when the math chunk fails', async () => {
  const errors: unknown[] = [];
  const html = await new Promise<string>((resolve, reject) => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, done) { output += chunk.toString(); done(); },
      final(done) { resolve(output); done(); },
    });
    destination.on('error', reject);
    const stream = renderToPipeableStream(createElement(Markdown, {
      text: 'Before\n\n$$\n<x>\n$$\n\nAfter',
    }), {
      onAllReady() { stream.pipe(destination); },
      onError(error) { errors.push(error); },
      onShellError: reject,
    });
  });
  expect(errors).toEqual([]);
  expect(html).toContain('<p>Before</p>');
  expect(html).toContain('<p>After</p>');
  expect(html).toContain('&lt;x&gt;');
  expect(html).toContain('Math rendering unavailable; showing source.');
});
