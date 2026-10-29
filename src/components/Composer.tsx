import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Attachment } from '../lib/chats';
import { ATTACHMENT_ACCEPT, fileExtension, formatBytes, MAX_FILE_BYTES, MAX_FILES, MAX_IMAGE_BYTES, MAX_PDF_BYTES } from '../lib/attachments';
import {
  attachDraftFiles,
  captureDraft,
  consumeSubmittedDraft,
  clearDraftErrors,
  getDraft,
  removeDraftAttachment,
  setDraftText,
  subscribeToDraft,
} from '../lib/drafts';
import { isDesktop } from '../lib/desktop';
import type { ModelSettings } from '../lib/models';
import { ArrowUpIcon, CloseIcon, MicIcon, PlusIcon, StopIcon } from './Icons';
import type { TaskResult } from '../shared/tasks';
import { ModelPicker } from './ModelPicker';
import './Composer.css';

interface Props {
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSend: (text: string, attachments: Attachment[]) => Promise<TaskResult | void> | void;
  /** Reject before consuming the draft, including the complete conversation's provider limits. */
  validateSend?: (text: string, attachments: Attachment[]) => string | null;
  disabled: boolean;
  busy?: boolean;
  /** While a reply streams, sending pauses but composing remains available. */
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Use a stable conversation or new-conversation key to retain its draft. */
  draftKey?: string;
  /** Disable for temporary chats. Attachment contents always remain in memory. */
  persistDraft?: boolean;
  /** Seeds an editable prompt; changing id applies a new suggestion. */
  prefill?: { text: string; id: number };
  /** Connection or project context, displayed when no transient status is active. */
  footerNote?: ReactNode;
}

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

// Electron ships the Web Speech API without a recognition backend, so dictation is browser-only.
const SpeechRecognitionCtor: (new () => Recognition) | undefined =
  typeof window === 'undefined' || isDesktop()
    ? undefined
    : ((window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined;

export function Composer({
  model, onModelChange, onSend, disabled, busy = false, onStop, placeholder, autoFocus = true,
  draftKey, persistDraft = true, prefill, validateSend, footerNote,
}: Props) {
  const instanceId = useId();
  const key = draftKey ?? instanceId;
  const persistent = !!draftKey && persistDraft;
  const subscribe = useCallback((listener: () => void) => subscribeToDraft(key, listener, persistent), [key, persistent]);
  const snapshot = useCallback(() => getDraft(key, persistent), [key, persistent]);
  const { text, attachments, pendingFiles, errors } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const dragDepth = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !submitting && pendingFiles === 0;
  const stopMode = busy && !!onStop;
  const hintId = `${instanceId}-hint`;
  const status = pendingFiles > 0 ? `Reading ${pendingFiles} ${pendingFiles === 1 ? 'file' : 'files'}…` :
    listening ? 'Listening. Select the microphone to finish.' :
      notice || (submitting ? 'Sending…' : busy ? 'New messages wait for this task. Interrupt to apply sooner.' : '');

  useEffect(() => setSendError(null), [text, attachments, key]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
  }, [text, key]);

  useEffect(() => {
    if (!prefill) return;
    setDraftText(key, prefill.text, persistent);
    ref.current?.focus();
  }, [prefill?.id, key, persistent]);

  useEffect(() => {
    activeKey.current = key;
    dragDepth.current = 0;
    setNotice('');
    setDragging(false);
    setListening(false);
    return () => {
      if (activeKey.current === key) activeKey.current = '';
      const current = recognition.current;
      if (current) {
        current.onresult = current.onend = current.onerror = null;
        current.stop();
        recognition.current = null;
      }
    };
  }, [key]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const count = await attachDraftFiles(key, files, persistent);
    if (count && activeKey.current === key) {
      setNotice(`${count} ${count === 1 ? 'file' : 'files'} ready to send`);
    }
  };

  const submit = async () => {
    const submitted = captureDraft(key, persistent);
    const draft = submitted.draft;
    if (disabled || submittingRef.current || draft.pendingFiles || (!draft.text.trim() && !draft.attachments.length)) return;
    const validationError = validateSend?.(draft.text.trim(), draft.attachments);
    if (validationError) { setSendError(validationError); ref.current?.focus(); return; }
    const current = recognition.current;
    if (current) { current.onresult = null; current.stop(); recognition.current = null; setListening(false); }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await onSend(draft.text.trim(), draft.attachments);
      if (result && !result.ok) { setSendError(result.message); return; }
      consumeSubmittedDraft(key, submitted, persistent);
      setNotice('');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not send. Your draft is still here.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      if (activeKey.current === key) ref.current?.focus();
    }
  };

  const toggleDictation = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new SpeechRecognitionCtor();
    const base = text ? `${text.trimEnd()} ` : '';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let said = '';
      for (let i = 0; i < event.results.length; i++) said += event.results[i][0].transcript;
      setDraftText(key, base + said, persistent);
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setNotice('Dictation unavailable. Check microphone access and try again.');
    };
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setNotice('Dictation unavailable. Check microphone access and try again.');
      recognition.current = null;
    }
  };

  return (
    <div className="composer-shell">
      <div
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void addFiles([...event.dataTransfer.files]);
        }}
      >
        {dragging && <div className="composer-drop">Drop PDFs, images, text, or code here</div>}
        {attachments.length > 0 && (
          <div className="composer-files" aria-label="Attached files">
            {attachments.map((file) => (
              <div key={file.id} className="file-chip" title={file.name}>
                {file.preview ? <img className="composer-file-preview" src={file.preview} alt={file.name} /> :
                  <span className="file-ext">{fileExtension(file.name)}</span>}
                <span className="file-meta">
                  <span className="file-name">{file.name}</span>
                  <span className="composer-file-size">{formatBytes(file.size)}</span>
                </span>
                <button
                  type="button"
                  className="file-remove"
                  title={`Remove ${file.name}`}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    removeDraftAttachment(key, file.id, persistent);
                    setNotice('File removed');
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        {errors.length > 0 && (
          <div className="composer-errors" role="alert">
            <div>{errors.map((error) => <p key={error}>{error}</p>)}</div>
            <button type="button" className="icon-btn" aria-label="Dismiss file errors" onClick={() => clearDraftErrors(key, persistent)}>
              <CloseIcon />
            </button>
          </div>
        )}
        {sendError && (
          <div className="composer-errors" role="alert">
            <p>{sendError}</p>
            <button type="button" className="icon-btn" aria-label="Dismiss message error" onClick={() => setSendError(null)}>
              <CloseIcon />
            </button>
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          aria-label="Message"
          aria-describedby={hintId}
          autoFocus={autoFocus}
          placeholder={listening ? 'Listening…' : (placeholder ?? (disabled ? 'Write a follow-up…' : 'Ask anything'))}
          value={text}
          onChange={(event) => setDraftText(key, event.target.value, persistent)}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (!pasted.length) return;
            event.preventDefault();
            void addFiles(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="icon-btn composer-plus"
              title={`Add PDFs (${formatBytes(MAX_PDF_BYTES)}), images (${formatBytes(MAX_IMAGE_BYTES)}), text or code (${formatBytes(MAX_FILE_BYTES)}) · ${MAX_FILES} files max`}
              aria-label="Add files"
              onClick={() => fileInput.current?.click()}
            >
              <PlusIcon />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <ModelPicker value={model} onChange={onModelChange} />
          </div>
          <div className="composer-send-tools">
            {SpeechRecognitionCtor && (
              <button
                type="button"
                className={`icon-btn composer-mic${listening ? ' listening' : ''}`}
                title={listening ? 'Stop dictation' : 'Dictate'}
                aria-label={listening ? 'Stop dictation' : 'Dictate'}
                aria-pressed={listening}
                onClick={toggleDictation}
              >
                <MicIcon />
              </button>
            )}
            {stopMode && (
              <button type="button" className="icon-btn" title="Stop generating" aria-label="Stop generating" onClick={onStop}>
                <StopIcon />
              </button>
            )}
              <button
                type="button"
                className="send-btn"
                title={pendingFiles ? 'Reading files…' : busy ? 'Queue message' : 'Send message'}
                aria-label={busy ? 'Queue message' : 'Send message'}
                onClick={submit}
                disabled={!canSend}
              >
                <ArrowUpIcon />
              </button>
          </div>
        </div>
      </div>
      <div className="composer-footer" id={hintId}>
        <div className="composer-status" role={status ? 'status' : undefined} aria-live={status ? 'polite' : undefined}>
          {status || footerNote}
        </div>
        <span className="composer-key-hint"><kbd>Enter</kbd> to {busy ? 'queue' : 'send'} <span aria-hidden="true">·</span> <kbd>Shift Enter</kbd> for a new line</span>
      </div>
    </div>
  );
}
