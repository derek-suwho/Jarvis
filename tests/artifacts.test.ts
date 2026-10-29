import { describe, expect, it } from 'vitest';
import { artifactKind, htmlDocument, svgDataUrl } from '../src/lib/artifacts';

describe('artifactKind', () => {
  it('renders mermaid and svg blocks', () => {
    expect(artifactKind('mermaid', 'graph TD; A-->B')).toBe('mermaid');
    expect(artifactKind('svg', '<svg></svg>')).toBe('svg');
    expect(artifactKind('xml', '  <svg viewBox="0 0 1 1"></svg>')).toBe('svg');
  });

  it('renders only whole HTML documents', () => {
    expect(artifactKind('html', '<!DOCTYPE html>\n<html></html>')).toBe('html');
    expect(artifactKind('html', '<html><body></body></html>')).toBe('html');
    expect(artifactKind('html', '<div class="x">hi</div>')).toBeNull();
  });

  it('leaves other code alone', () => {
    expect(artifactKind('ts', 'const a = 1')).toBeNull();
    expect(artifactKind('', '<svg></svg>')).toBeNull();
  });
});

describe('htmlDocument', () => {
  it('keeps the doctype first and puts the policy before the page', () => {
    const doc = htmlDocument('<!doctype html><html><body>hi</body></html>');
    expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain("connect-src 'none'");
    expect(doc.match(/<!doctype/gi)).toHaveLength(1);
    expect(doc.endsWith('<html><body>hi</body></html>')).toBe(true);
  });
});

describe('svgDataUrl', () => {
  it('encodes markup as an image URL', () => {
    expect(svgDataUrl('<svg a="#"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E');
  });
});
