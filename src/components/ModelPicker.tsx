import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelSettings } from '../lib/models';
import {
  AUTO_MODEL_ID,
  CLAUDE_MODES,
  GROUP_SITES,
  REASONING_LEVELS,
  groupModels,
  isClaudeModel,
  modelLabel,
} from '../lib/models';
import { CheckIcon, ChevronDownIcon, SearchIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import './ModelPicker.css';

interface Props {
  value: ModelSettings;
  onChange: (settings: ModelSettings) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 440 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const label = modelLabel(value);
  const groups = groupModels(query);
  const showAuto = !query.trim() || 'auto'.includes(query.trim().toLowerCase());

  const close = (restore = true) => {
    setOpen(false);
    setQuery('');
    setError(null);
    if (restore) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (event.defaultPrevented || ('button' in event && event.button !== 0)) return;
      const node = event.target as Node;
      if (!panelRef.current?.contains(node) && !triggerRef.current?.contains(node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const onResize = () => close(false);
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer, { passive: true });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) return close();
    const bounds = triggerRef.current!.getBoundingClientRect();
    const height = Math.min(460, window.innerHeight - 32);
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const down = below >= height || below > above;
    const maxHeight = Math.min(height, down ? below : above);
    setPosition({
      left: Math.max(12, Math.min(bounds.left, window.innerWidth - 332)),
      top: down ? bounds.bottom + 8 : Math.max(12, bounds.top - maxHeight - 8),
      maxHeight,
    });
    setOpen(true);
  };

  const saveSettings = (settings: ModelSettings, dismiss = false) => {
    setError(null);
    try {
      onChange(settings);
      if (dismiss) close();
    } catch {
      setError('Could not save model settings. Try again.');
    }
  };
  const select = (modelId: string, reasoning = value.reasoning) => {
    saveSettings({ ...value, modelId, reasoning }, true);
  };

  return (
    <div className="model-picker">
      <button
        ref={triggerRef}
        className={`model-trigger${open ? ' open' : ''}`}
        onClick={toggle}
        onBlur={(event) => {
          if (open && !panelRef.current?.contains(event.relatedTarget as Node)) close(false);
        }}
        aria-label={`Choose model, current ${label.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
      >
        <span>{label.name}</span>
        {isClaudeModel(value.modelId) && (
          <span className="muted model-detail">{value.claudeMode === 'code' ? 'Code' : value.reasoning}</span>
        )}
        <ChevronDownIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={dialogId}
            className="model-popover"
            role="dialog"
            aria-label="Choose a model"
            style={position}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                event.relatedTarget !== triggerRef.current
              )
                close(false);
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLSelectElement) return;
              const options = [...panelRef.current!.querySelectorAll<HTMLButtonElement>('.model-choice')];
              if (!options.length) return;
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'Home' || event.key === 'End') {
                // Preserve caret movement while editing the model search.
                if (index < 0) return;
                event.preventDefault();
                options[event.key === 'Home' ? 0 : options.length - 1].focus();
                return;
              }
              event.preventDefault();
              const next =
                index < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : options.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
              options[next].focus();
            }}
          >
            <div className="model-search-wrap">
              <SearchIcon />
              <input
                ref={searchRef}
                className="model-search-input"
                aria-label="Search models"
                placeholder="Search models…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="model-list">
              {showAuto && (
                <button
                  className="model-choice auto-choice"
                  aria-pressed={value.modelId === AUTO_MODEL_ID}
                  onClick={() => select(AUTO_MODEL_ID)}
                >
                  <span>
                    <strong>Auto</strong>
                    <small>Use a connected plan</small>
                  </span>
                  {value.modelId === AUTO_MODEL_ID && <CheckIcon />}
                </button>
              )}
              {groups.map((group) => (
                <div key={group.group} className="model-group">
                  <div className="model-group-heading">
                    <SiteIcon site={GROUP_SITES[group.group] ?? ''} size={13} fallback={null} />
                    {group.group}
                  </div>
                  {group.models.map((model) => (
                    <button
                      className="model-choice"
                      key={model.id}
                      aria-pressed={model.id === value.modelId}
                      onClick={() => select(model.id, model.defaultReasoning)}
                    >
                      <span>{model.name}</span>
                      {model.id === value.modelId && <CheckIcon />}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 &&
                (query.trim() ? (
                  !showAuto && <p className="menu-empty" role="status">No models match “{query}”.</p>
                ) : (
                  <p className="menu-empty">Add a subscription in Settings to see its models.</p>
                ))}
            </div>
            {isClaudeModel(value.modelId) && (
              <div className="model-options">
                <label>
                  Reasoning
                  <select
                    value={value.reasoning}
                    onChange={(event) =>
                      saveSettings({ ...value, reasoning: event.target.value as ModelSettings['reasoning'] })
                    }
                  >
                    {REASONING_LEVELS.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Mode
                  <select
                    value={value.claudeMode}
                    onChange={(event) =>
                      saveSettings({ ...value, claudeMode: event.target.value as ModelSettings['claudeMode'] })
                    }
                  >
                    {CLAUDE_MODES.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {error && <p className="task-error" role="alert">{error}</p>}
            <div className="model-footer">Availability depends on your connected plan.</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
