import { useEffect, useRef, useState } from 'react';

/** Copies text and reports `copied` for a moment so buttons can show a check. */
export function useCopy(): [boolean, (text: string) => void, string] {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number>();
  const mounted = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async (text: string) => {
    if (!mounted.current) return;
    const currentRequest = ++request.current;
    window.clearTimeout(timer.current);
    if (mounted.current) { setCopied(false); setError(''); }
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (!mounted.current || currentRequest !== request.current) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (mounted.current && currentRequest === request.current) setCopied(false);
      }, 1500);
    } catch {
      if (mounted.current && currentRequest === request.current) {
        setError('Could not copy. Try again or select the text to copy manually.');
      }
    }
  };
  return [copied, copy, error];
}

/** Shared dismiss behavior for popovers: outside mouse/touch input or Escape closes. */
export function useDismiss(open: boolean, ref: React.RefObject<HTMLElement>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (e.defaultPrevented || ('button' in e && e.button !== 0)) return;
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}
