import { useEffect, useRef, useState } from 'react';
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
  const [query, setQuery] = useState('');
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
    if (restore) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointer = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!panelRef.current?.contains(node) && !triggerRef.current?.contains(node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
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

  const select = (modelId: string, reasoning = value.reasoning) => {
    onChange({ ...value, modelId, reasoning });
    close();
  };

  return (
    <div className="model-picker">
      <button
        ref={triggerRef}
        className={`model-trigger${open ? ' open' : ''}`}
        onClick={toggle}
        aria-label={`Choose model, current ${label.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
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
              if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target instanceof HTMLSelectElement) return;
              const options = [...panelRef.current!.querySelectorAll<HTMLButtonElement>('.model-choice')];
              if (!options.length) return;
              event.preventDefault();
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
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
                  !showAuto && <p className="menu-empty">No models match “{query}”.</p>
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
                      onChange({ ...value, reasoning: event.target.value as ModelSettings['reasoning'] })
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
                      onChange({ ...value, claudeMode: event.target.value as ModelSettings['claudeMode'] })
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
            <div className="model-footer">Availability depends on your connected plan.</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
