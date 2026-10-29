import { useRef, useState } from 'react';
import { CloseIcon } from './Icons';
import { useDialog } from './useDialog';

interface Props {
  title: string;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}

export function RenameDialog({ title, initialValue, onClose, onSave }: Props) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id="rename-title">{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) onSave(value.trim());
          }}
        >
          <label htmlFor="rename-input">Name</label>
          <input
            id="rename-input"
            className="settings-input"
            autoFocus
            maxLength={120}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="edit-actions">
            <button type="button" className="pill-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="pill-btn primary" disabled={!value.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
