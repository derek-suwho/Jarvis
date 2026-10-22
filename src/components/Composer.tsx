import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '../lib/chats';
import { fileExtension, formatBytes, toAttachment, vetFiles } from '../lib/attachments';
import { isDesktop } from '../lib/desktop';
import type { ModelSettings } from '../lib/models';
import { ArrowUpIcon, CloseIcon, MicIcon, PlusIcon, StopIcon } from './Icons';
import { ModelPicker } from './ModelPicker';

interface Props {
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  disabled: boolean;
  /** When set and `disabled` (a reply is streaming), the send button becomes Stop. */
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
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

export function Composer({ model, onModelChange, onSend, disabled, onStop, placeholder, autoFocus = true }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const canSend = (text.trim().length > 0 || files.length > 0) && !disabled;
  const stopMode = disabled && !!onStop;

  // Grow with content up to a cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => () => recognition.current?.stop(), []);

  const addFiles = async (list: File[]) => {
    const { accepted, errors } = vetFiles(list, files.length);
    setErrors(errors);
    const added = await Promise.all(accepted.map(toAttachment));
    setFiles((fs) => [...fs, ...added]);
  };

  const submit = () => {
    if (!canSend) return;
    recognition.current?.stop();
    onSend(text.trim(), files);
    setText('');
    setFiles([]);
    setErrors([]);
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
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setText(base + said);
    };
    r.onend = r.onerror = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      {(files.length > 0 || errors.length > 0) && (
        <div className="composer-files">
          {files.map((f) => (
            <div key={f.id} className={`file-chip${f.preview ? ' image' : ''}`} title={f.name}>
              {f.preview ? (
                <img src={f.preview} alt={f.name} />
              ) : (
                <>
                  <span className="file-ext">{fileExtension(f.name)}</span>
                  <span className="file-meta">
                    <span className="file-name">{f.name}</span>
                    <span className="mono">{formatBytes(f.size)}</span>
                  </span>
                </>
              )}
              <button className="file-remove" title={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>
                <CloseIcon />
              </button>
            </div>
          ))}
          {errors.map((e) => (
            <span key={e} className="composer-error">
              {e}
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button className="icon-btn composer-plus" title="Add photos & files" onClick={() => fileInput.current?.click()}>
          <PlusIcon />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          placeholder={listening ? 'Listening…' : (placeholder ?? 'Ask anything')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length === 0) return;
            e.preventDefault();
            void addFiles(pasted);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <ModelPicker value={model} onChange={onModelChange} />
        {SpeechRecognitionCtor && (
          <button
            className={`icon-btn composer-mic${listening ? ' listening' : ''}`}
            title={listening ? 'Stop dictation' : 'Dictate'}
            onClick={toggleDictation}
          >
            <MicIcon />
          </button>
        )}
        {stopMode ? (
          <button className="send-btn" title="Stop generating" aria-label="Stop generating" onClick={onStop}>
            <StopIcon />
          </button>
        ) : (
          <button className="send-btn" title="Send" aria-label="Send" onClick={submit} disabled={!canSend}>
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </div>
  );
}
