import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Chat } from '../lib/chats';
import type { Project } from '../lib/projects';
import { ArchiveIcon, ChevronRightIcon, CloseIcon, DotsIcon, DownloadIcon, FolderIcon, PencilIcon, PinIcon, TrashIcon } from './Icons';

export interface ChatActions {
  onRename: (id: string) => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onMove: (id: string, projectId: string | undefined) => void;
}

interface Props extends ChatActions {
  chat: Chat;
  projects: Project[];
  variant?: 'row' | 'topbar';
}

export function ChatMenu({ chat, projects, variant = 'row', ...actions }: Props) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusMove = useRef(false);

  const close = (restore = true) => {
    setOpen(false);
    setMoveOpen(false);
    if (restore) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      const below = trigger.bottom + 6;
      setPosition({
        top: Math.max(8, below + menu.height <= window.innerHeight - 8 ? below : trigger.top - menu.height - 6),
        left: Math.max(8, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, moveOpen, projects.length]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (moveOpen && focusMove.current) {
      menuRef.current?.querySelector<HTMLButtonElement>('[data-move-option]')?.focus();
      focusMove.current = false;
    }
  }, [moveOpen]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (icon: JSX.Element, label: string, action: () => void, danger = false, move = false) => (
    <button
      key={label}
      className={`menu-option${danger ? ' danger' : ''}`}
      role="menuitem"
      data-move-option={move || undefined}
      onClick={(event) => {
        event.stopPropagation();
        close();
        action();
      }}
    >
      <span className="menu-option-label">{icon}{label}</span>
    </button>
  );

  return (
    <div className={`chat-menu ${variant === 'topbar' ? 'toolbar' : 'row'}${open ? ' open' : ''}`} onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        className={`icon-btn chat-menu-trigger${open ? ' pressed' : ''}`}
        title="Chat options"
        aria-label={`Options for ${chat.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? close() : setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      ><DotsIcon /></button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="menu chat-menu-list floating-chat-menu"
          role="menu"
          aria-label={`Options for ${chat.title}`}
          style={position}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown') items[(current + 1) % items.length]?.focus();
            else if (event.key === 'ArrowUp') items[(current - 1 + items.length) % items.length]?.focus();
            else if (event.key === 'Home') items[0]?.focus();
            else if (event.key === 'End') items[items.length - 1]?.focus();
            else if (event.key === 'ArrowRight' && (event.target as HTMLElement).closest('[data-move-toggle]')) {
              focusMove.current = true;
              setMoveOpen(true);
            } else if (event.key === 'ArrowLeft' && moveOpen) {
              setMoveOpen(false);
              menuRef.current?.querySelector<HTMLButtonElement>('[data-move-toggle]')?.focus();
            } else if (event.key === 'Escape') close();
            else if (event.key === 'Tab') {
              close();
              return;
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {item(<PencilIcon />, 'Rename', () => actions.onRename(chat.id))}
          {item(<PinIcon />, chat.pinned ? 'Unpin chat' : 'Pin chat', () => actions.onTogglePin(chat.id))}
          <button className={`menu-option${moveOpen ? ' current' : ''}`} role="menuitem" aria-expanded={moveOpen} data-move-toggle onClick={() => setMoveOpen((value) => !value)}>
            <span className="menu-option-label"><FolderIcon />Move to project</span>
            <span className={`move-chevron${moveOpen ? ' open' : ''}`}><ChevronRightIcon /></span>
          </button>
          {moveOpen && (
            <div className="move-list" role="group" aria-label="Projects">
              {projects.length === 0 && <div className="menu-empty">Create a project in the sidebar first.</div>}
              {projects.map((project) => item(<span className={`move-dot${chat.projectId === project.id ? ' on' : ''}`} />, project.name, () => actions.onMove(chat.id, project.id), false, true))}
              {chat.projectId && item(<CloseIcon />, 'Remove from project', () => actions.onMove(chat.id, undefined), false, true)}
            </div>
          )}
          {item(<DownloadIcon />, 'Export as Markdown', () => actions.onExport(chat.id))}
          <div className="menu-divider" role="separator" />
          {item(<ArchiveIcon />, 'Archive chat', () => actions.onArchive(chat.id))}
          {item(<TrashIcon />, 'Delete chat', () => actions.onDelete(chat.id), true)}
        </div>,
        document.body,
      )}
    </div>
  );
}
