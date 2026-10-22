import { useEffect, useRef, useState } from 'react';
import type { Feedback, Message } from '../lib/chats';
import { fileExtension, formatBytes } from '../lib/attachments';
import { Markdown } from './Markdown';
import { useCopy } from './useCopy';
import { CheckIcon, CopyIcon, PencilIcon, ReloadIcon, SpeakerIcon, StopIcon, ThumbDownIcon, ThumbUpIcon } from './Icons';

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

function ActionButton({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button className={`icon-btn msg-action${active ? ' pressed' : ''}`} title={title} aria-label={title} onClick={onClick}>
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
    <div className="message assistant">
      {m.model && <div className="message-model">{m.model}</div>}
      {m.content ? (
        <div className={streaming ? 'streaming' : undefined}>
          <Markdown text={m.content} />
        </div>
      ) : (
        <div className="skeleton" aria-label="Generating reply">
          <span />
          <span />
          <span />
        </div>
      )}
      {!streaming && m.content && (
        <div className={`msg-actions${isLast ? ' visible' : ''}`}>
          <ActionButton title={copied ? 'Copied' : 'Copy'} onClick={() => copy(m.content)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionButton>
          {onFeedback && (
            <>
              <ActionButton title="Good response" active={m.feedback === 'up'} onClick={() => onFeedback(m.id, m.feedback === 'up' ? undefined : 'up')}>
                <ThumbUpIcon />
              </ActionButton>
              <ActionButton title="Bad response" active={m.feedback === 'down'} onClick={() => onFeedback(m.id, m.feedback === 'down' ? undefined : 'down')}>
                <ThumbDownIcon />
              </ActionButton>
            </>
          )}
          {canSpeak && (
            <ActionButton title={speaking ? 'Stop reading' : 'Read aloud'} active={speaking} onClick={speak}>
              {speaking ? <StopIcon /> : <SpeakerIcon />}
            </ActionButton>
          )}
          {isLast && onRegenerate && !busy && (
            <ActionButton title="Regenerate" onClick={() => onRegenerate(m.id)}>
              <ReloadIcon />
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
