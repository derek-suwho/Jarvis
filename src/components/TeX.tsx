import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** KaTeX output; with `trust` off it escapes input and allows no links, scripts or styles from the TeX. */
export default function TeX({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', trust: false }),
    [tex, display],
  );
  const Tag = display ? 'div' : 'span';
  return <Tag className={display ? 'md-math-display' : 'md-math'} dangerouslySetInnerHTML={{ __html: html }} />;
}

