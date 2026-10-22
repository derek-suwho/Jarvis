import { useEffect, useRef, useState } from 'react';
import { ExpandIcon, NewTabIcon, SideChatIcon, SmallPlusIcon } from './Icons';

interface Props {
  onNewTab: () => void;
  onNewTabFull: () => void;
  onSideChat: () => void;
}

export function NewTabMenu({ onNewTab, onNewTabFull, onSideChat }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (icon: JSX.Element, label: string, kbd: string, action: () => void) => (
    <div
      className="menu-option"
      onClick={() => {
        action();
        setOpen(false);
      }}
    >
      <span className="menu-option-label">
        {icon}
        {label}
      </span>
      <span className="kbd">{kbd}</span>
    </div>
  );

  return (
    <div className="newtab-menu" ref={rootRef}>
      <button className={`icon-btn${open ? ' pressed' : ''}`} title="New tab" onClick={() => setOpen((o) => !o)}>
        <NewTabIcon />
      </button>
      {open && (
        <div className="menu newtab-dropdown">
          {item(<SmallPlusIcon />, 'New tab', '⇧⌘B', onNewTab)}
          {item(<ExpandIcon />, 'New tab in full view', '⇧⌘F', onNewTabFull)}
          <div className="menu-divider" />
          {item(<SideChatIcon />, 'Side chat', '⌥⌘S', onSideChat)}
        </div>
      )}
    </div>
  );
}
