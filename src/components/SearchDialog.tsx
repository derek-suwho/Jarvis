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
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const failedChatRef = useRef<string | undefined>(undefined);
  const listId = useId();
  useDialog(dialogRef, onClose);
  const matches = useMemo(
    () => filterChats(sortByRecent(chats.filter((chat) => !chat.temporary)), query),
    [chats, query],
  );
  const results = matches.slice(0, LIMIT);
  const total = results.length + 1;
  const selected = Math.min(cursor, total - 1);
  const selectedChatId = results[selected]?.id;

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (selectedChatId !== failedChatRef.current) setError('');
  }, [selectedChatId]);
  useEffect(() => {
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, listId, matches]);

  const choose = (index: number) => {
    setError('');
    try {
      if (index === results.length) onNewChat();
      else if (results[index]) onSelect(results[index].id);
    } catch {
      failedChatRef.current = results[index]?.id;
      setCursor(index);
      setError(index === results.length
        ? 'Could not start a new chat. Try again.'
        : 'Could not open this conversation. Try again.');
      inputRef.current?.focus();
      return;
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop top" onMouseDown={(event) => !event.defaultPrevented && event.button === 0 && event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="search-dialog" role="dialog" aria-modal="true" aria-label="Search conversations">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            autoFocus
            className="search-dialog-input"
            placeholder="Search your conversations"
            aria-label="Search conversations"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-describedby={error ? `${listId}-error` : undefined}
            aria-activedescendant={`${listId}-${selected}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'ArrowDown') setCursor((current) => (Math.min(current, total - 1) + 1) % total);
              else if (event.key === 'ArrowUp') setCursor((current) => (Math.min(current, total - 1) - 1 + total) % total);
              else if (event.key === 'PageDown') setCursor((current) => Math.min(Math.min(current, total - 1) + 10, total - 1));
              else if (event.key === 'PageUp') setCursor((current) => Math.max(Math.min(current, total - 1) - 10, 0));
              else if (event.key === 'Home' && !query) setCursor(0);
              else if (event.key === 'End' && !query) setCursor(total - 1);
              else if (event.key === 'Enter') {
                if (!event.repeat) choose(selected);
              }
              else return;
              event.preventDefault();
            }}
          />
          {query && <button type="button" className="icon-btn" aria-label="Clear search" title="Clear search" onClick={(event) => {
            if (event.defaultPrevented) return;
            setQuery('');
            setCursor(0);
            setError('');
            inputRef.current?.focus();
          }}><CloseIcon /></button>}
          <button className="icon-btn" aria-label="Close search" title="Close search" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="search-results" id={listId} role="listbox" aria-label="Conversations">
          {results.length > 0 && <div className="search-section-label" aria-hidden="true">{query.trim() ? 'Matching conversations' : 'Recent conversations'}</div>}
          {results.length === 0 && (
            <div className="search-empty" role="status">
              <strong>{query.trim() ? `No matches for “${query}”` : 'Your next conversation starts here'}</strong>
              <span>{query.trim() ? 'Try a different word or search for a message.' : 'Conversations you save will appear here.'}</span>
            </div>
          )}
          {results.map((chat, index) => {
            const project = projects.find((item) => item.id === chat.projectId);
            const date = new Date(chat.updatedAt);
            return (
              <button
                key={chat.id}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected === index}
                className={`search-row${selected === index ? ' active' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => { if (!event.defaultPrevented) choose(index); }}
              >
                <SideChatIcon />
                <span className="search-text">
                  <span className="search-title"><Highlight text={chat.title} query={query} /></span>
                  <span className="search-snippet"><Highlight text={snippet(chat, query)} query={query} /></span>
                  {(project || chat.archived) && <span className="search-context">{project?.name}{project && chat.archived ? ' · ' : ''}{chat.archived ? 'Archived' : ''}</span>}
                </span>
                {Number.isFinite(date.getTime())
                  ? <time className="search-date" dateTime={date.toISOString()}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                  : <span className="search-date">Date unavailable</span>}
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
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => { if (!event.defaultPrevented) choose(results.length); }}
          >
            <ComposeIcon /><span className="search-title">Start a new chat</span>
          </button>
        </div>
        {error && <p id={`${listId}-error`} className="task-error" role="alert">{error}</p>}
        <footer className="search-footer">
          <span aria-live="polite">{query.trim() ? `${matches.length} result${matches.length === 1 ? '' : 's'}${matches.length > LIMIT ? ` · Showing ${LIMIT} · Narrow your search to find other matches` : ''}` : matches.length > LIMIT ? `Showing ${LIMIT} recent conversations · Search to find older chats` : 'Search titles and messages'}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Open</span>
        </footer>
      </div>
    </div>
  );
}
