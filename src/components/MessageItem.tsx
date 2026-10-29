import { useEffect, useRef, useState } from 'react';
import type { Feedback, Message, ToolUse } from '../lib/chats';
import { fileExtension, formatBytes } from '../lib/attachments';
import { Markdown } from './Markdown';
import { useCopy } from './useCopy';
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  PencilIcon,
  ReloadIcon,
  SpeakerIcon,
  StopIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from './Icons';

interface Props {
  message: Message;
  streaming: boolean;
  /** Regenerate is offered on the latest reply only, as in ChatGPT and Claude. */
  isLast: boolean;
  busy: boolean;
  onEdit?: (id: string, text: string) => void;
  onRegenerate?: (id: string) => void;
  onFeedback?: (id: string, f: Feedback | undefined) => void;
}

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

function toolLabel(t: ToolUse) {
  if (t.server === 'Skills' && t.detail) {
    return t.status === 'running'
      ? `Loading skill ${t.detail}`
      : t.status === 'error'
        ? `Skill ${t.detail} failed`
        : `Loaded skill ${t.detail}`;
  }
  const what = `${t.server} › ${t.tool}`;
  return t.status === 'running' ? `Using ${what}` : t.status === 'error' ? `${what} failed` : `Used ${what}`;
}

/** Tool calls made while writing the reply, shown above it. */
function ToolActivity({ tools }: { tools: ToolUse[] }) {
  return (
    <ul className="tool-activity">
      {tools.map((t) => (
        <li key={t.id} className={t.status}>
          <span className="tool-mark">
            {t.status === 'running' ? (
              <span className="tool-spinner" />
            ) : t.status === 'error' ? (
              <CloseIcon />
            ) : (
              <CheckIcon />
            )}
          </span>
          <span className="tool-label">{toolLabel(t)}</span>
          {t.detail && t.server !== 'Skills' && <span className="tool-detail mono">{t.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function Attachments({ message }: { message: Message }) {
  if (!message.attachments?.length) return null;
  return (
    <div className="msg-attachments">
      {message.attachments.map((a) =>
        a.preview ? (
          <img key={a.id} className="msg-thumb" src={a.preview} alt={a.name} title={a.name} />
        ) : (
          <div key={a.id} className="file-chip" title={a.name}>
            <span className="file-ext">{fileExtension(a.name)}</span>
            <span className="file-meta">
              <span className="file-name">{a.name}</span>
              <span className="mono">{formatBytes(a.size)}</span>
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`icon-btn msg-action${active ? ' pressed' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MessageItem({ message: m, streaming, isLast, busy, onEdit, onRegenerate, onFeedback }: Props) {
  const [copied, copy] = useCopy();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [speaking, setSpeaking] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [editing, draft]);

  useEffect(() => () => void (speaking && window.speechSynthesis.cancel()), [speaking]);

  const speak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(m.content.replace(/[*_`#>|]/g, ''));
    u.onend = u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  if (m.role === 'user') {
    if (editing) {
      const save = () => {
        const t = draft.trim();
        if (!t) return;
        setEditing(false);
        if (t !== m.content) onEdit?.(m.id, t);
      };
      return (
        <div className="message user editing">
          <div className="edit-box">
            <textarea
              ref={editRef}
              autoFocus
              aria-label="Edit message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <p className="edit-warning">Sending an edit replaces the replies after this message.</p>
            <div className="edit-actions">
              <button className="pill-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="pill-btn primary" onClick={save} disabled={!draft.trim() || busy}>
                Send
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="message user">
        <Attachments message={m} />
        {m.content && <div className="message-body">{m.content}</div>}
        {m.delivery === 'cancelled' && <p className="message-outcome">Not applied. Send again to include this instruction.</p>}
        <div className="msg-actions">
          <ActionButton title={copied ? 'Copied' : 'Copy'} onClick={() => copy(m.content)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionButton>
          {onEdit && !busy && (
            <ActionButton
              title="Edit message"
              onClick={() => {
                setDraft(m.content);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </ActionButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`message assistant${m.error ? ' error' : ''}`} role={m.error ? 'alert' : undefined}>
      {m.model && <div className="message-model">{m.model}</div>}
      {m.outcome && m.outcome !== 'complete' && <p className="message-outcome">{m.outcome === 'interrupted' ? 'Interrupted — partial response' : m.outcome === 'cancelled' ? 'Stopped — partial response' : 'Incomplete response'}</p>}
      {m.tools && m.tools.length > 0 && <ToolActivity tools={m.tools} />}
      {m.error ? (
        <div className="reply-error">
          <strong>Couldn’t complete this response</strong>
          <p>{m.content}</p>
          {isLast && onRegenerate && !busy && (
            <button className="pill-btn" onClick={() => onRegenerate(m.id)}>
              <ReloadIcon />
              Try again
            </button>
          )}
        </div>
      ) : m.content ? (
        <div className={streaming ? 'streaming' : undefined}>
          <Markdown text={m.content} />
        </div>
      ) : streaming ? (
        <div className="skeleton" aria-label="Generating reply">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <p className="settings-hint">No text response was returned.</p>
      )}
      {!streaming && m.content && (
        <div className={`msg-actions${isLast ? ' visible' : ''}`}>
          <ActionButton title={copied ? 'Copied' : 'Copy'} onClick={() => copy(m.content)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionButton>
          {onFeedback && !m.error && (
            <>
              <ActionButton
                title="Good response"
                active={m.feedback === 'up'}
                onClick={() => onFeedback(m.id, m.feedback === 'up' ? undefined : 'up')}
              >
                <ThumbUpIcon />
              </ActionButton>
              <ActionButton
                title="Bad response"
                active={m.feedback === 'down'}
                onClick={() => onFeedback(m.id, m.feedback === 'down' ? undefined : 'down')}
              >
                <ThumbDownIcon />
              </ActionButton>
            </>
          )}
          {canSpeak && !m.error && (
            <ActionButton title={speaking ? 'Stop reading' : 'Read aloud'} active={speaking} onClick={speak}>
              {speaking ? <StopIcon /> : <SpeakerIcon />}
            </ActionButton>
          )}
          {isLast && onRegenerate && !busy && !m.error && (
            <ActionButton title="Regenerate" onClick={() => onRegenerate(m.id)}>
              <ReloadIcon />
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
