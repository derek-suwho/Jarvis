import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { Chat } from '../lib/chats';
import { filterChats, sortByRecent } from '../lib/chats';
import { ComposeIcon, SearchIcon, SidebarIcon, TrashIcon } from './Icons';

interface Props {
  chats: Chat[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}

export function Sidebar({ chats, activeId, onNewChat, onSelect, onDelete, onCollapse }: Props) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const visible = filterChats(sortByRecent(chats), query);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">
          <span className="brand-mark">J</span>
          Jarvis
        </span>
        <div className="header-actions">
          <button
            className="icon-btn"
            title="Search chats"
            onClick={() => {
              setSearching((s) => !s);
              setQuery('');
            }}
          >
            <SearchIcon />
          </button>
          <button className="icon-btn" title="Close sidebar" onClick={onCollapse}>
            <SidebarIcon />
          </button>
        </div>
      </div>

      <button className="nav-item" onClick={onNewChat}>
        <ComposeIcon />
        <span>New chat</span>
      </button>

      {searching && (
        <input
          className="search-input"
          autoFocus
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearching(false)}
        />
      )}

      <div className="section-label">Recents</div>
      <nav className="history">
        {visible.length === 0 && (
          <div className="history-empty">{query ? 'No chats match that search.' : 'Your conversations will appear here once you send a message.'}</div>
        )}
        {visible.map((c, i) => (
          <div
            key={c.id}
            className={`history-item${c.id === activeId ? ' active' : ''}`}
            style={{ '--i': i } as CSSProperties}
            onClick={() => onSelect(c.id)}
          >
            <span className="history-title">{c.title}</span>
            <button
              className="icon-btn delete-btn"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
