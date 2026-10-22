import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ModelSettings } from '../lib/models';
import {
  AUTO_MODEL_ID,
  CONTEXT_SIZES,
  GROUP_SITES,
  REASONING_LEVELS,
  groupModels,
  modelLabel,
  modelName,
} from '../lib/models';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from './Icons';
import { SiteIcon } from './SiteIcon';
import './ModelPicker.css';

type Submenu = 'context' | 'reasoning' | 'model' | null;

interface Props {
  value: ModelSettings;
  onChange: (s: ModelSettings) => void;
}

const MENU_HEIGHT = 400;
const SUBMENU_WIDTH = 300;

export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [query, setQuery] = useState('');
  const [flip, setFlip] = useState({ up: false, left: false });
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) return close();
    // Open away from the window edges: upward when docked at the bottom, submenu leftward near the right edge.
    const r = rootRef.current!.getBoundingClientRect();
    setFlip({ up: r.bottom + MENU_HEIGHT > window.innerHeight, left: r.right + SUBMENU_WIDTH > window.innerWidth });
    setOpen(true);
  };

  const update = (patch: Partial<ModelSettings>) => onChange({ ...value, ...patch });
  const pick = (patch: Partial<ModelSettings>) => {
    update(patch);
    close();
  };

  const label = modelLabel(value);
  const isAuto = value.modelId === AUTO_MODEL_ID;
  const groups = groupModels(query);
  const showAuto = !query.trim() || 'auto'.includes(query.trim().toLowerCase());

  const row = (key: Exclude<Submenu, null>, title: string, current: string) => (
    <div
      className={`menu-row${submenu === key ? ' highlighted' : ''}`}
      onMouseEnter={() => setSubmenu(key)}
      onClick={() => setSubmenu(key)}
    >
      <span>{title}</span>
      <span className="menu-row-value">
        {current}
        <ChevronRightIcon />
      </span>
    </div>
  );

  return (
    <div className="model-picker" ref={rootRef}>
      <button className={`model-trigger${open ? ' open' : ''}`} onClick={toggle}>
        <span>{label.name}</span>
        {label.detail && <span className="muted">{label.detail}</span>}
        <ChevronDownIcon />
      </button>

      {open && (
        <div className={`menu${flip.up ? ' up' : ''}`}>
          <div className="menu-row" onMouseEnter={() => setSubmenu(null)} onClick={() => update({ fast: !value.fast })}>
            <span>Fast</span>
            <span className={`switch${value.fast ? ' on' : ''}`} role="switch" aria-checked={value.fast} />
          </div>
          {row('context', 'Context', value.context)}
          {!isAuto && row('reasoning', 'Reasoning', value.reasoning)}
          <div className="menu-divider" />
          {row('model', 'Model', modelName(value.modelId))}

          {submenu && (
            <div className={`submenu${flip.left ? ' left' : ''}${submenu === 'model' ? ' wide' : ''}`}>
              {submenu === 'context' &&
                CONTEXT_SIZES.map((c) => (
                  <Option key={c} selected={c === value.context} onClick={() => pick({ context: c })}>
                    {c}
                  </Option>
                ))}

              {submenu === 'reasoning' &&
                REASONING_LEVELS.map((r) => (
                  <Option key={r} selected={r === value.reasoning} onClick={() => pick({ reasoning: r })}>
                    {r}
                  </Option>
                ))}

              {submenu === 'model' && (
                <>
                  <input
                    className="menu-search"
                    autoFocus
                    placeholder="Search models"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="menu-scroll">
                    {showAuto && (
                      <>
                        <Option selected={isAuto} onClick={() => pick({ modelId: AUTO_MODEL_ID })}>
                          Auto
                        </Option>
                        <div className="menu-divider" />
                      </>
                    )}
                    {groups.map((g, i) => (
                      <div key={g.group}>
                        {i > 0 && <div className="menu-divider" />}
                        <div className="menu-group-label">
                          <SiteIcon site={GROUP_SITES[g.group] ?? ''} size={14} fallback={null} />
                          {g.group}
                        </div>
                        {g.models.map((m) => (
                          <Option
                            key={m.id}
                            selected={m.id === value.modelId}
                            onClick={() => pick({ modelId: m.id, reasoning: m.defaultReasoning })}
                          >
                            {m.name} <span className="muted">{m.defaultReasoning}</span>
                            {m.isNew && <span className="badge">NEW</span>}
                          </Option>
                        ))}
                      </div>
                    ))}
                    {!showAuto && groups.length === 0 && <div className="menu-empty">No models found</div>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="menu-option" onClick={onClick}>
      <span className="menu-option-label">{children}</span>
      {selected && <CheckIcon />}
    </div>
  );
}
