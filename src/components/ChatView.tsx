import type { CSSProperties, ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
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
  /** Shown above the start-screen heading. */
  banner?: ReactNode;
  /** Shown under the composer. */
  composerNote?: ReactNode;
}

const NEAR_BOTTOM_PX = 120;
/** Gap kept above the anchored user message, like ChatGPT. */
const ANCHOR_GAP_PX = 24;

export function ChatView(p: Props) {
  const { chat, pending, model, onModelChange, onSend, onStop, streamingId, suggestions } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const messages = chat?.messages ?? [];
  const last = messages[messages.length - 1];

  const spacerRef = useRef<HTMLDivElement>(null);
  /** User message pinned to the top while its reply streams in below it. */
  const anchorRef = useRef<HTMLElement | null>(null);

  // Size the spacer so the anchored message can sit at the top even when the reply is still short.
  const fitSpacer = () => {
    const scroller = scrollRef.current;
    const spacer = spacerRef.current;
    const anchor = anchorRef.current;
    if (!scroller || !spacer || !endRef.current) return;
    if (!anchor?.isConnected) {
      spacer.style.height = '0px';
      return;
    }
    const used = endRef.current.getBoundingClientRect().top - anchor.getBoundingClientRect().top - spacer.offsetHeight;
    spacer.style.height = `${Math.max(0, scroller.clientHeight - ANCHOR_GAP_PX - used)}px`;
  };

  useLayoutEffect(() => {
    anchorRef.current = null;
    fitSpacer();
    endRef.current?.scrollIntoView({ block: 'end' });
    setAtBottom(true);
  }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a reply starts, pin the latest user message to the top instead of following the bottom.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!pending || !scroller) return;
    const users = scroller.querySelectorAll<HTMLElement>('.message.user');
    anchorRef.current = users[users.length - 1] ?? null;
    fitSpacer();
    const anchor = anchorRef.current;
    if (anchor) {
      const offset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - ANCHOR_GAP_PX;
      scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: 'smooth' });
    }
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shrink the spacer as streamed text fills the space.
  useLayoutEffect(fitSpacer, [messages.length, last?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  const composer = (
    <>
      <Composer model={model} onModelChange={onModelChange} onSend={onSend} disabled={pending} onStop={onStop} placeholder={p.placeholder} />
      {p.composerNote}
    </>
  );

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-inner">
          {p.banner}
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
          <div ref={spacerRef} aria-hidden />
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
