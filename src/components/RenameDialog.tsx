import { useId, useRef, useState } from 'react';
import { CloseIcon } from './Icons';
import { useDialog } from './useDialog';

interface Props {
  title: string;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}

export function RenameDialog({ title, initialValue, onClose, onSave }: Props) {
  const id = useId();
  const titleId = `${id}-title`;
  const inputId = `${id}-input`;
  const errorId = `${id}-error`;
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedInitialName = useRef(false);
  useDialog(ref, onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => !event.defaultPrevented && event.button === 0 && event.target === event.currentTarget && onClose()}>
      <div
        className="compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={(event) => { if (!event.defaultPrevented) onClose(); }}>
            <CloseIcon />
          </button>
        </header>
        <form
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
          }}
          onSubmit={(event) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (!value.trim()) {
              setError('Enter a name.');
              inputRef.current?.focus();
              return;
            }
            if (value.trim().length > 120) {
              setError('Use a name of 120 characters or fewer.');
              inputRef.current?.focus();
              return;
            }
            setError('');
            try { onSave(value.trim()); }
            catch {
              setError('Could not rename. Your name is still here. Try again.');
              inputRef.current?.focus();
            }
          }}
        >
          <label htmlFor={inputId}>Name</label>
          <input
            ref={inputRef}
            id={inputId}
            aria-invalid={error && (!value.trim() || value.trim().length > 120) ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="settings-input"
            autoFocus
            maxLength={120}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
            }}
            onFocus={(event) => {
              if (selectedInitialName.current) return;
              selectedInitialName.current = true;
              event.currentTarget.select();
            }}
          />
          {error && <p id={errorId} className="task-error" role="alert">{error}</p>}
          <div className="edit-actions">
            <button type="button" className="pill-btn" onClick={(event) => { if (!event.defaultPrevented) onClose(); }}>
              Cancel
            </button>
            <button className="pill-btn primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
