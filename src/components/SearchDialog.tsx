import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Chat } from '../lib/chats';
import { filterChats, sortByRecent } from '../lib/chats';
import type { Project } from '../lib/projects';
import { CloseIcon, ComposeIcon, SearchIcon, SideChatIcon } from './Icons';
import { useDialog } from './useDialog';
import './Dialogs.css';

interface Props {
  chats: Chat[];
  projects?: Project[];
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

const LIMIT = 40;

function snippet(chat: Chat, query: string): string {
  const needle = query.trim().toLowerCase();
  const message = needle
    ? chat.messages.find((item) => item.content.toLowerCase().includes(needle))
    : chat.messages[chat.messages.length - 1];
  if (!message) return '';
  const index = needle ? message.content.toLowerCase().indexOf(needle) : 0;
  const start = Math.max(0, index - 40);
  return (start > 0 ? '…' : '') + message.content.slice(start, start + 140).replace(/\s+/g, ' ');
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
}

export function SearchDialog({ chats, projects = [], onSelect, onNewChat, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDialog(dialogRef, onClose);
  const matches = useMemo(
    () => filterChats(sortByRecent(chats.filter((chat) => !chat.temporary)), query),
    [chats, query],
  );
  const results = matches.slice(0, LIMIT);
  const total = results.length + 1;
  const selected = Math.min(cursor, total - 1);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, listId]);

  const choose = (index: number) => {
    if (index === results.length) onNewChat();
    else if (results[index]) onSelect(results[index].id);
    onClose();
  };

  return (
    <div className="dialog-backdrop top" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="search-dialog" role="dialog" aria-modal="true" aria-label="Search conversations">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            autoFocus
            className="search-dialog-input"
            placeholder="Search your conversations"
            aria-label="Search conversations"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${selected}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') setCursor((current) => (current + 1) % total);
              else if (event.key === 'ArrowUp') setCursor((current) => (current - 1 + total) % total);
              else if (event.key === 'Enter' && !event.nativeEvent.isComposing) choose(selected);
              else return;
              event.preventDefault();
            }}
          />
          <button className="icon-btn" aria-label="Close search" title="Close search" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="search-results" id={listId} role="listbox" aria-label="Conversations">
          {results.length > 0 && <div className="search-section-label" aria-hidden="true">{query.trim() ? 'Matching conversations' : 'Recent conversations'}</div>}
          {results.length === 0 && (
            <div className="search-empty" role="status">
              <strong>{query ? `No matches for “${query}”` : 'Your next conversation starts here'}</strong>
              <span>{query ? 'Try a different word or search for a message.' : 'Conversations you save will appear here.'}</span>
            </div>
          )}
          {results.map((chat, index) => {
            const project = projects.find((item) => item.id === chat.projectId);
            return (
              <button
                key={chat.id}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected === index}
                className={`search-row${selected === index ? ' active' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(index)}
              >
                <SideChatIcon />
                <span className="search-text">
                  <span className="search-title"><Highlight text={chat.title} query={query} /></span>
                  <span className="search-snippet"><Highlight text={snippet(chat, query)} query={query} /></span>
                  {(project || chat.archived) && <span className="search-context">{project?.name}{project && chat.archived ? ' · ' : ''}{chat.archived ? 'Archived' : ''}</span>}
                </span>
                <time className="search-date" dateTime={new Date(chat.updatedAt).toISOString()}>{new Date(chat.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
              </button>
            );
          })}
          <button
            id={`${listId}-${results.length}`}
            role="option"
            tabIndex={-1}
            aria-selected={selected === results.length}
            className={`search-row search-new${selected === results.length ? ' active' : ''}`}
            onMouseEnter={() => setCursor(results.length)}
            onClick={() => choose(results.length)}
          >
            <ComposeIcon /><span className="search-title">Start a new chat</span>
          </button>
        </div>
        <footer className="search-footer">
          <span aria-live="polite">{query.trim() ? `${matches.length} result${matches.length === 1 ? '' : 's'}${matches.length > LIMIT ? ` · Showing ${LIMIT}` : ''}` : 'Search titles and messages'}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Open</span>
        </footer>
      </div>
    </div>
  );
}
