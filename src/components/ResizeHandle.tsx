import { useEffect, useRef, useState } from 'react';

/** A width the user dragged to, remembered across launches; null until they drag. */
export function useStoredWidth(key: string, min: number, max: number) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const [width, setWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved ? clamp(saved) : null;
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
  onResize: (width: number) => void;
  onReset: () => void;
}

/** Drag, arrow keys, or double-click (reset) to change a panel's width. */
export function ResizeHandle({ label, edge, measure, onResize, onReset }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const sign = edge === 'right' ? 1 : -1;
  const end = () => {
    start.current = null;
    document.body.classList.remove('resizing');
  };
  return (
    <div
      className={`resize-handle ${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: measure() };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.width + sign * (e.clientX - start.current.x));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(measure() - 16 * sign);
        else if (e.key === 'ArrowRight') onResize(measure() + 16 * sign);
        else return;
        e.preventDefault();
      }}
    />
  );
}
