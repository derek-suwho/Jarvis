import { useEffect, useRef, useState } from 'react';

/** A width the user dragged to, remembered across launches; null until they drag. */
export function useStoredWidth(key: string, min: number, max: number) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const [width, setWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved && Number.isFinite(saved) ? clamp(saved) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (width === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(width));
    } catch {
      // Storage unavailable — keep in memory only.
    }
  }, [key, width]);
  return [width, (w: number | null) => setWidth(w === null ? null : clamp(w))] as const;
}

interface Props {
  label: string;
  /** Which edge of the resized element the handle sits on. */
  edge: 'left' | 'right';
  /** Current rendered width, read at drag start. */
  measure: () => number;
  minWidth?: number;
  maxWidth?: number;
  onResize: (width: number) => void;
  onReset: () => void;
}

/** Drag or arrow keys resize; Home/End reach bounds; Enter or double-click restores the default width. */
export function ResizeHandle({ label, edge, measure, minWidth, maxWidth, onResize, onReset }: Props) {
  const resizeCallback = useRef(onResize);
  resizeCallback.current = onResize;
  const separator = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = separator.current;
    if (!node) return;
    const update = () => {
      const width = Math.round(measure());
      node.setAttribute('aria-valuetext', `${width} pixels`);
      node.setAttribute('aria-valuenow', String(width));
    };
    update();
    if (!node.parentElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, [measure]);
  const start = useRef<{ pointerId: number; x: number; width: number; latestWidth: number; target: HTMLDivElement } | null>(null);
  const sign = edge === 'right' ? 1 : -1;
  const resize = (width: number) => {
    const next = Math.min(maxWidth ?? Infinity, Math.max(minWidth ?? -Infinity, width));
    if (start.current) start.current.latestWidth = next;
    onResize(next);
  };
  const end = () => {
    const drag = start.current;
    start.current = null;
    document.body.classList.remove('resizing');
    try {
      if (drag?.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    } catch {
      // Native cancellation may expire the pointer before capture is released.
    }
  };
  const endPointer = (event: React.PointerEvent) => {
    if (start.current?.pointerId === event.pointerId) end();
  };
  const cancel = () => {
    const drag = start.current;
    end();
    if (drag && drag.latestWidth !== drag.width) resizeCallback.current(drag.width);
  };
  useEffect(() => {
    const onBlur = () => {
      if (start.current) end();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !start.current || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('blur', onBlur);
    // Cancel the drag before document-level modal/popover dismissal handles Escape.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown, true);
      if (start.current) end();
    };
  }, []);
  return (
    <div
      className={`resize-handle ${edge}`}
      role="separator"
      ref={separator}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-orientation="vertical"
      aria-label={label}
      aria-description={`Use Left and Right arrows to resize${minWidth !== undefined && maxWidth !== undefined ? ', Home and End for minimum and maximum width' : ''}, or Enter to restore the default width.`}
      aria-keyshortcuts="Enter"
      tabIndex={0}
      onBlur={() => {
        if (start.current) end();
      }}
      onPointerDown={(e) => {
        if (e.defaultPrevented || e.button !== 0 || start.current) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        try { e.currentTarget.setPointerCapture(e.pointerId); }
        catch { return; } // The pointer may have become inactive before capture.
        const width = measure();
        start.current = { pointerId: e.pointerId, x: e.clientX, width, latestWidth: width, target: e.currentTarget };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (!start.current || start.current.pointerId !== e.pointerId) return;
        // Recover when a release was missed before this move was delivered.
        if (e.buttons !== undefined && (e.buttons & 1) === 0) { end(); return; }
        resize(start.current.width + sign * (e.clientX - start.current.x));
      }}
      onPointerUp={(event) => {
        const drag = start.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        // A release can carry a newer position than the last delivered move.
        if (Number.isFinite(event.clientX)) resize(drag.width + sign * (event.clientX - drag.x));
        end();
      }}
      onPointerCancel={(event) => {
        if (start.current?.pointerId === event.pointerId) cancel();
      }}
      onLostPointerCapture={endPointer}
      onDoubleClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (start.current) end();
        onReset();
      }}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === 229) return;
        if (e.key === 'Enter' && e.repeat) {
          e.preventDefault();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End'].includes(e.key)) return;
        if (e.key === 'Home' && minWidth === undefined) return;
        if (e.key === 'End' && maxWidth === undefined) return;
        if (start.current) end();
        if (e.key === 'ArrowLeft') resize(measure() - 16 * sign);
        else if (e.key === 'ArrowRight') resize(measure() + 16 * sign);
        else if (e.key === 'Home') onResize(minWidth!);
        else if (e.key === 'End') onResize(maxWidth!);
        else if (e.key === 'Enter') onReset();
        else return;
        e.preventDefault();
      }}
    />
  );
}
