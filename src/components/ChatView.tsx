import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Attachment, Chat, Feedback } from '../lib/chats';
import type { ModelSettings } from '../lib/models';
import { Composer } from './Composer';
import './ChatView.css';
import { ArrowDownIcon, ArrowRightIcon } from './Icons';
import { MessageItem } from './MessageItem';
import './Messages.css';

interface Props {
  chat: Chat | null;
  pending: boolean;
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  onEdit?: (messageId: string, text: string) => void;
  onRegenerate?: (messageId: string) => void;
  onFeedback?: (messageId: string, f: Feedback | undefined) => void;
  /** Id of the assistant message currently streaming. */
  streamingId?: string | null;
  emptyTitle?: string;
  eyebrow?: string;
  suggestions?: string[];
  /** Extra content under the empty-state composer (e.g. a project's chat list). */
  emptyFooter?: ReactNode;
  placeholder?: string;
  disclaimer?: boolean;
}

const NEAR_BOTTOM_PX = 120;

export function ChatView(p: Props) {
  const { chat, pending, model, onModelChange, onSend, onStop, streamingId, suggestions } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const messages = chat?.messages ?? [];
  const last = messages[messages.length - 1];

  // Follow new messages and streamed text, but only while the reader is already at the bottom.
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, last?.content, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    setAtBottom(true);
  }, [chat?.id]);

  const composer = (
    <Composer model={model} onModelChange={onModelChange} onSend={onSend} disabled={pending} onStop={onStop} placeholder={p.placeholder} />
  );

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-inner">
          {p.eyebrow !== '' && <p className="eyebrow">{p.eyebrow ?? 'New conversation'}</p>}
          <h1>{p.emptyTitle ?? 'Where should we begin?'}</h1>
          {composer}
          {suggestions && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((s, i) => (
                <li key={s} style={{ '--i': i } as CSSProperties}>
                  <button onClick={() => onSend(s, [])} disabled={pending}>
                    <span>{s}</span>
                    <ArrowRightIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.emptyFooter}
        </div>
      </div>
    );
  }

  return (
    <div className="conversation">
      <div
        className="messages-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
        }}
      >
        <div className="messages">
          {messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              streaming={m.id === streamingId}
              isLast={i === messages.length - 1}
              busy={pending}
              onEdit={p.onEdit}
              onRegenerate={p.onRegenerate}
              onFeedback={p.onFeedback}
            />
          ))}
          {pending && last?.role === 'user' && (
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
      </div>
      <div className="composer-dock">
        {!atBottom && (
          <button
            className="scroll-bottom"
            title="Scroll to bottom"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
          >
            <ArrowDownIcon />
          </button>
        )}
        <div className="composer-wrap">{composer}</div>
        {p.disclaimer && <p className="disclaimer">Jarvis can make mistakes. Check important info.</p>}
      </div>
    </div>
  );
}
