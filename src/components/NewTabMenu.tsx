import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ExpandIcon, NewTabIcon, SideChatIcon, SmallPlusIcon, TemporaryIcon } from './Icons';

interface Props {
  onNewTab: () => void;
  onNewTabFull: () => void;
  onSideChat: () => void;
  /** Whether a not-yet-saved temporary chat is currently on. */
  temporaryOn: boolean;
  onTemporaryChat: () => void;
}

export function NewTabMenu({ onNewTab, onNewTabFull, onSideChat, temporaryOn, onTemporaryChat }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (icon: JSX.Element, label: string, kbd: string | JSX.Element, action: () => void) => (
    <button
      className="menu-option"
      role="menuitem"
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
    </button>
  );

  return (
    <div className="newtab-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`icon-btn${open ? ' pressed' : ''}`}
        title="New tab, side chat, or temporary chat"
        aria-label="Workspace options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <NewTabIcon />
      </button>
      {open && (
        <div
          className="menu newtab-dropdown"
          role="menu"
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {item(<SmallPlusIcon />, 'New tab', '⇧⌘B', onNewTab)}
          {item(<ExpandIcon />, 'New tab in full view', '⇧⌘F', onNewTabFull)}
          <div className="menu-divider" />
          {item(<SideChatIcon />, 'Side chat', '⌥⌘S', onSideChat)}
          {item(
            <TemporaryIcon />,
            temporaryOn ? 'Turn off temporary chat' : 'Temporary chat',
            temporaryOn ? <CheckIcon /> : '',
            onTemporaryChat,
          )}
        </div>
      )}
    </div>
  );
}
