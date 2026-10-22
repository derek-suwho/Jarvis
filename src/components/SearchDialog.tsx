import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../lib/chats';
import { filterChats, sortByRecent } from '../lib/chats';
import { ComposeIcon, SideChatIcon } from './Icons';
import './Dialogs.css';

interface Props {
  chats: Chat[];
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

const LIMIT = 30;

/** Text around the first match so results show why they matched. */
function snippet(chat: Chat, q: string): string {
  const needle = q.trim().toLowerCase();
  const m = needle ? chat.messages.find((x) => x.content.toLowerCase().includes(needle)) : chat.messages[chat.messages.length - 1];
  if (!m) return '';
  const i = needle ? m.content.toLowerCase().indexOf(needle) : 0;
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + m.content.slice(start, start + 120).replace(/\s+/g, ' ');
}

export function SearchDialog({ chats, onSelect, onNewChat, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const results = useMemo(
    () => filterChats(sortByRecent(chats.filter((c) => !c.temporary && !c.archived)), query).slice(0, LIMIT),
    [chats, query],
  );
  // Row 0 is "New chat"; results follow.
  const total = results.length + 1;

  useEffect(() => setCursor(0), [query]);

  const choose = (i: number) => {
    if (i === 0) onNewChat();
    else onSelect(results[i - 1].id);
    onClose();
  };

  return (
    <div className="dialog-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search chats">
        <input
          autoFocus
          className="search-dialog-input"
          placeholder="Search chats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') setCursor((c) => (c + 1) % total);
            else if (e.key === 'ArrowUp') setCursor((c) => (c - 1 + total) % total);
            else if (e.key === 'Enter') choose(cursor);
            else return;
            e.preventDefault();
          }}
        />
        <div className="search-results" role="listbox">
          <div className={`search-row${cursor === 0 ? ' active' : ''}`} onMouseEnter={() => setCursor(0)} onClick={() => choose(0)}>
            <ComposeIcon />
            <span className="search-title">New chat</span>
          </div>
          {results.length === 0 && query && <div className="search-empty">No chats match “{query}”.</div>}
          {results.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={cursor === i + 1}
              className={`search-row${cursor === i + 1 ? ' active' : ''}`}
              onMouseEnter={() => setCursor(i + 1)}
              onClick={() => choose(i + 1)}
            >
              <SideChatIcon />
              <span className="search-text">
                <span className="search-title">{c.title}</span>
                <span className="search-snippet">{snippet(c, query)}</span>
              </span>
              <span className="mono">{new Date(c.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
