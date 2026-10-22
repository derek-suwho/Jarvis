import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { Chat } from '../lib/chats';
import type { ModelSettings } from '../lib/models';
import { Composer } from './Composer';
import './ChatView.css';
import { ArrowRightIcon } from './Icons';

interface Props {
  chat: Chat | null;
  pending: boolean;
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSend: (text: string) => void;
  emptyTitle?: string;
  eyebrow?: string;
  suggestions?: string[];
  /** Shown above the start-screen heading. */
  banner?: ReactNode;
  /** Shown under the composer. */
  composerNote?: ReactNode;
}

export function ChatView({
  chat,
  pending,
  model,
  onModelChange,
  onSend,
  emptyTitle,
  eyebrow,
  suggestions,
  banner,
  composerNote,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length, pending]);

  const composer = (
    <>
      <Composer model={model} onModelChange={onModelChange} onSend={onSend} disabled={pending} />
      {composerNote}
    </>
  );

  if (!chat || chat.messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-inner">
          {banner}
          <p className="eyebrow">{eyebrow ?? 'New conversation'}</p>
          <h1>{emptyTitle ?? 'Where should we begin?'}</h1>
          {composer}
          {suggestions && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((s, i) => (
                <li key={s} style={{ '--i': i } as CSSProperties}>
                  <button onClick={() => onSend(s)} disabled={pending}>
                    <span>{s}</span>
                    <ArrowRightIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="conversation">
      <div className="messages">
        {chat.messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            {m.role === 'assistant' && m.model && <div className="message-model">{m.model}</div>}
            <div className="message-body">{m.content}</div>
          </div>
        ))}
        {pending && (
          <div className="message assistant" aria-label="Generating reply">
            <div className="skeleton">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="composer-dock">
        <div className="composer-wrap">{composer}</div>
      </div>
    </div>
  );
}
