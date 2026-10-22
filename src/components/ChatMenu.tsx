import { Fragment, useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import type { Project } from '../lib/projects';
import { ArchiveIcon, ChevronRightIcon, CloseIcon, DotsIcon, DownloadIcon, FolderIcon, PencilIcon, PinIcon, TrashIcon } from './Icons';
import { useDismiss } from './useCopy';

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
  /** Topbar uses a visible trigger; sidebar rows reveal it on hover. */
  variant?: 'row' | 'topbar';
}

export function ChatMenu({ chat, projects, variant = 'row', ...a }: Props) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, rootRef, () => {
    setOpen(false);
    setMoveOpen(false);
  });

  const item = (icon: JSX.Element, label: string, action: () => void, danger = false) => (
    <div
      key={label}
      className={`menu-option${danger ? ' danger' : ''}`}
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        action();
        setOpen(false);
      }}
    >
      <span className="menu-option-label">
        {icon}
        {label}
      </span>
    </div>
  );

  return (
    <div className={`chat-menu ${variant}${open ? ' open' : ''}`} ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button
        className={`icon-btn chat-menu-trigger${open ? ' pressed' : ''}`}
        title="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="menu chat-menu-list" role="menu">
          {item(<DownloadIcon />, 'Export as Markdown', () => a.onExport(chat.id))}
          {item(<PencilIcon />, 'Rename', () => a.onRename(chat.id))}
          {item(<PinIcon />, chat.pinned ? 'Unpin' : 'Pin', () => a.onTogglePin(chat.id))}
          <div className={`menu-option${moveOpen ? ' current' : ''}`} onClick={() => setMoveOpen((m) => !m)}>
            <span className="menu-option-label">
              <FolderIcon />
              Move to project
            </span>
            <span className={`move-chevron${moveOpen ? ' open' : ''}`}>
              <ChevronRightIcon />
            </span>
          </div>
          {moveOpen && (
            <div className="move-list">
              {projects.length === 0 && <div className="menu-empty">No projects yet</div>}
              {projects.map((p) => (
                <Fragment key={p.id}>
                  {item(<span className={`move-dot${chat.projectId === p.id ? ' on' : ''}`} />, p.name, () => a.onMove(chat.id, p.id))}
                </Fragment>
              ))}
              {chat.projectId && item(<CloseIcon />, 'Remove from project', () => a.onMove(chat.id, undefined))}
            </div>
          )}
          {item(<ArchiveIcon />, 'Archive', () => a.onArchive(chat.id))}
          <div className="menu-divider" />
          {item(<TrashIcon />, 'Delete', () => a.onDelete(chat.id), true)}
        </div>
      )}
    </div>
  );
}
