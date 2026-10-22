import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import { groupChats, recentChats } from '../lib/chats';
import { initials } from '../lib/preferences';
import type { Project } from '../lib/projects';
import type { ChatActions } from './ChatMenu';
import { ChatMenu } from './ChatMenu';
import { ComposeIcon, FolderIcon, GearIcon, SearchIcon, SidebarIcon, SmallPlusIcon } from './Icons';

interface Props extends ChatActions {
  chats: Chat[];
  projects: Project[];
  activeId: string | null;
  activeProjectId: string | null;
  /** Chat whose title is being edited inline. */
  renamingId: string | null;
  userName: string;
  subscriptionCount: number;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameDone: (id: string, title: string | null) => void;
  onSearch: () => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

export function Sidebar(p: Props) {
  const [creating, setCreating] = useState(false);
  const groups = groupChats(recentChats(p.chats));
  const { projects, activeId, renamingId } = p;
  const actions: ChatActions = {
    onRename: p.onRename,
    onTogglePin: p.onTogglePin,
    onArchive: p.onArchive,
    onDelete: p.onDelete,
    onExport: p.onExport,
    onMove: p.onMove,
  };
  let index = 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-header drag-region">
        <span className="brand">
          <span className="brand-mark">J</span>
          Jarvis
        </span>
        <div className="header-actions">
          <button className="icon-btn" title="Close sidebar" onClick={p.onCollapse}>
            <SidebarIcon />
          </button>
        </div>
      </div>

      <button className="nav-item" onClick={p.onNewChat}>
        <ComposeIcon />
        <span>New chat</span>
        <span className="kbd nav-kbd">⇧⌘O</span>
      </button>
      <button className="nav-item" onClick={p.onSearch}>
        <SearchIcon />
        <span>Search chats</span>
        <span className="kbd nav-kbd">⌘K</span>
      </button>

      <nav className="history">
        <div className="section-label section-row">
          <span>Projects</span>
          <button className="icon-btn section-add" title="New project" onClick={() => setCreating(true)}>
            <SmallPlusIcon />
          </button>
        </div>
        {creating && (
          <div className="history-item">
            <FolderIcon />
            <RenameInput
              initial=""
              onDone={(v) => {
                setCreating(false);
                if (v?.trim()) p.onCreateProject(v);
              }}
            />
          </div>
        )}
        {projects.map((pr) => (
          <div
            key={pr.id}
            className={`history-item project-item${pr.id === p.activeProjectId ? ' active' : ''}`}
            onClick={() => p.onSelectProject(pr.id)}
          >
            <FolderIcon />
            <span className="history-title">{pr.name}</span>
            <span className="mono">{p.chats.filter((c) => c.projectId === pr.id && !c.archived).length || ''}</span>
          </div>
        ))}
        {projects.length === 0 && !creating && (
          <button className="history-item ghost" onClick={() => setCreating(true)}>
            <SmallPlusIcon />
            <span className="history-title">New project</span>
          </button>
        )}

        {groups.length === 0 && (
          <>
            <div className="section-label">Recents</div>
            <div className="history-empty">Your conversations will appear here once you send a message.</div>
          </>
        )}
        {groups.map((g) => (
          <div key={g.label} className="history-group">
            <div className="section-label">{g.label}</div>
            {g.chats.map((c) => (
              <div
                key={c.id}
                className={`history-item${c.id === activeId ? ' active' : ''}`}
                style={{ '--i': index++ } as CSSProperties}
                onClick={() => p.onSelect(c.id)}
              >
                {renamingId === c.id ? (
                  <RenameInput initial={c.title} onDone={(v) => p.onRenameDone(c.id, v)} />
                ) : (
                  <span className="history-title">{c.title}</span>
                )}
                <ChatMenu chat={c} projects={projects} {...actions} />
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="profile-btn" onClick={p.onOpenSettings} title="Settings (⌘,)">
          <span className="avatar">{initials(p.userName)}</span>
          <span className="profile-text">
            <span className="profile-name">{p.userName.trim() || 'You'}</span>
            <span className="profile-plan">
              {p.subscriptionCount === 0 ? 'Add your AI plans' : `${p.subscriptionCount} plan${p.subscriptionCount > 1 ? 's' : ''} linked`}
            </span>
          </span>
          <GearIcon />
        </button>
      </div>
    </aside>
  );
}
