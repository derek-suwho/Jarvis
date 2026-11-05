import { useEffect, useId, useRef, useState } from 'react';
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
  const [error, setError] = useState('');
  const errorId = useId();
  const menuId = `${errorId}-menu`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingFromEnd = useRef(false);

  useEffect(() => {
    if (!open) {
      setError('');
      return;
    }
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[openingFromEnd.current ? items.length - 1 : 0]?.focus();
    openingFromEnd.current = false;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (e.defaultPrevented || ('button' in e && e.button !== 0)) return;
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onWindowBlur = () => {
      setOpen(false);
      setError('');
    };
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (icon: JSX.Element, label: string, kbd: string | JSX.Element, action: () => void) => (
    <button
      className="menu-option"
      role="menuitem"
      aria-describedby={error ? errorId : undefined}
      onClick={(event) => {
        setError('');
        triggerRef.current?.focus();
        try {
          action();
        } catch {
          setError('Could not complete this action. Try again.');
          event.currentTarget.focus();
          return;
        }
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
    <div
      className="newtab-menu"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className={`icon-btn${open ? ' pressed' : ''}`}
        title="New tab, side chat, or temporary chat"
        aria-label="Workspace options"
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openingFromEnd.current = event.key === 'ArrowUp';
          setOpen(true);
        }}
      >
        <NewTabIcon />
      </button>
      {open && (
        <div
          className="menu newtab-dropdown"
          role="menu"
          id={menuId}
          aria-label="Workspace options"
          onKeyDown={(event) => {
            if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const nextIndex = index < 0
                ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[nextIndex]?.focus();
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
            } else if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
              const initial = event.key.toLocaleLowerCase();
              for (let offset = 1; offset <= items.length; offset++) {
                const candidate = items[(index + offset + items.length) % items.length];
                const label = candidate.querySelector('.menu-option-label')?.textContent?.trim().toLocaleLowerCase();
                if (label?.startsWith(initial)) {
                  event.preventDefault();
                  candidate.focus();
                  break;
                }
              }
            }
            if (event.key === 'Tab') {
              // Keep native Tab traversal anchored when the focused menu unmounts.
              triggerRef.current?.focus();
              setOpen(false);
            }
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
          {error && <p id={errorId} className="task-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
