import { useEffect, useRef, useState } from 'react';
import type { ModelSettings } from '../lib/models';
import { ArrowUpIcon, PlusIcon } from './Icons';
import { ModelPicker } from './ModelPicker';

interface Props {
  model: ModelSettings;
  onModelChange: (s: ModelSettings) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}

export function Composer({ model, onModelChange, onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0 && !disabled;

  // Grow with content up to a cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="composer">
      <button className="icon-btn composer-plus" title="Add attachment (coming soon)" disabled>
        <PlusIcon />
      </button>
      <textarea
        ref={ref}
        rows={1}
        autoFocus
        placeholder="Ask anything"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <ModelPicker value={model} onChange={onModelChange} />
      <button className="send-btn" title="Send" onClick={submit} disabled={!canSend}>
        <ArrowUpIcon />
      </button>
    </div>
  );
}
