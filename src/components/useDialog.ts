import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const dialogs: HTMLElement[] = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard navigation inside a modal and return focus to its opener. */
export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialogs.push(dialog);
    const isTop = () => dialogs[dialogs.length - 1] === dialog;
    const controls = (container = dialog) => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && !element.closest('[hidden], [inert]') && getComputedStyle(element).visibility === 'visible',
    ).sort((a, b) => {
      // Browsers visit positive tabindex values first, retaining DOM order for ties.
      const aOrder = a.tabIndex > 0 ? a.tabIndex : Infinity;
      const bOrder = b.tabIndex > 0 ? b.tabIndex : Infinity;
      return aOrder === bOrder ? 0 : aOrder - bOrder;
    });
    const active = document.activeElement;
    const unavailable = active instanceof HTMLElement && (active.matches(':disabled') || active.getClientRects().length === 0 || active.closest('[hidden], [inert]') || getComputedStyle(active).visibility !== 'visible');
    if (!dialog.contains(active) || unavailable) (controls()[0] ?? dialog).focus();

    const onKey = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.altKey || event.ctrlKey || event.metaKey || (event.key === 'Escape' && event.shiftKey)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) closeRef.current();
      } else if (event.key === 'Tab') {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && !dialog.contains(event.target as Node)) (controls()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      const restoreFocus = isTop();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      dialogs.splice(dialogs.indexOf(dialog), 1);
      if (restoreFocus) {
        const remaining = dialogs[dialogs.length - 1];
        if ((!remaining || (opener.current && remaining.contains(opener.current))) && opener.current?.isConnected && opener.current.getClientRects().length > 0 && !opener.current.matches(':disabled') && !opener.current.closest('[hidden], [inert]') && getComputedStyle(opener.current).visibility === 'visible') opener.current.focus();
        else {
          if (remaining) (controls(remaining)[0] ?? remaining).focus();
        }
      }
    };
  }, [ref]);
}
