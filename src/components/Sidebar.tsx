import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import { groupChats, recentChats } from '../lib/chats';
import { isMac } from '../lib/desktop';
import type { Project } from '../lib/projects';
import type { ChatActions } from './ChatMenu';
import type { TaskSnapshot } from '../shared/tasks';
import { TaskStatus } from './TasksPanel';
import { ChatMenu } from './ChatMenu';
import { ResizeHandle, useStoredWidth } from './ResizeHandle';
import { ChevronRightIcon, ComposeIcon, FolderIcon, SearchIcon, SmallPlusIcon } from './Icons';

interface Props extends ChatActions {
  chats: Chat[];
  tasks?: TaskSnapshot[];
  projects: Project[];
  activeId: string | null;
  activeProjectId: string | null;
  /** Chat whose title is being edited inline. */
  renamingId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameDone: (id: string, title: string | null) => void;
  onSearch: () => void;
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.select(), []);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      ref={ref}
      autoFocus
      aria-label={initial ? 'Conversation name' : 'Project name'}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

const PROJECTS_OPEN_KEY = 'jarvis.projectsOpen';
export function Sidebar(p: Props) {
  const [creating, setCreating] = useState(false);
  const [width, setWidth] = useStoredWidth('jarvis.sidebarWidth', 200, 480);
  const asideRef = useRef<HTMLElement>(null);
  const [projectsOpen, setProjectsOpen] = useState(() => {
    try { return localStorage.getItem(PROJECTS_OPEN_KEY) !== 'false'; } catch { return true; }
  });
  const toggleProjects = (open: boolean) => {
    setProjectsOpen(open);
    try { localStorage.setItem(PROJECTS_OPEN_KEY, String(open)); } catch { /* keep in memory only */ }
  };
  const groups = groupChats(recentChats(p.chats));
  const { projects, activeId } = p;
  const modifier = isMac() ? '⌘' : 'Ctrl';
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
    <aside ref={asideRef} id="chat-history" className="sidebar" aria-label="Chat history" style={width ? ({ '--sidebar-width': `${width}px` } as CSSProperties) : undefined}>
      <ResizeHandle label="Resize sidebar" edge="right" measure={() => asideRef.current?.offsetWidth ?? 256} onResize={setWidth} onReset={() => setWidth(null)} />
      <div className="sidebar-header drag-region">
        <span className="brand">
          Jarvis
        </span>
        <div className="header-actions">
          <button className="icon-btn" aria-label="Search chats" title={`Search chats (${modifier}K)`} onClick={p.onSearch}>
            <SearchIcon />
          </button>
        </div>
      </div>

      <button className="nav-item" aria-label="New chat" onClick={p.onNewChat}>
        <ComposeIcon />
        <span>New chat</span>
        <span className="kbd nav-kbd">{isMac() ? '⇧⌘O' : 'Ctrl ⇧ O'}</span>
      </button>

      <nav className="history" aria-label="Projects and conversations">
        <div className="section-label section-row">
          <button className={`section-toggle${projectsOpen ? ' open' : ''}`} aria-expanded={projectsOpen} onClick={() => toggleProjects(!projectsOpen)}>
            Projects
            <ChevronRightIcon />
          </button>
          <button className="icon-btn section-add" title="New project" onClick={() => { toggleProjects(true); setCreating(true); }}>
            <SmallPlusIcon />
          </button>
        </div>
        {projectsOpen && creating && (
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
        {projectsOpen && projects.map((pr) => (
          <button
            key={pr.id}
            className={`history-item project-item${pr.id === p.activeProjectId ? ' active' : ''}`}
            aria-current={pr.id === p.activeProjectId ? 'page' : undefined}
            title={pr.name}
            onClick={() => p.onSelectProject(pr.id)}
          >
            <FolderIcon />
            <span className="history-title">{pr.name}</span>
            <span className="mono">{p.chats.filter((c) => c.projectId === pr.id && !c.archived).length || ''}</span>
          </button>
        ))}
        {projectsOpen && projects.length === 0 && !creating && (
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
              >
                <button
                  className="history-select"
                  title={c.title}
                  aria-current={c.id === activeId ? 'page' : undefined}
                  onClick={() => p.onSelect(c.id)}
                >
                  <span className="history-title">{c.title}</span>
                  <TaskStatus task={p.tasks?.find((task) => task.target.kind === 'chat' && task.target.id === c.id)} />
                </button>
                <ChatMenu chat={c} projects={projects} {...actions} />
              </div>
            ))}
          </div>
        ))}
      </nav>

    </aside>
  );
}
