import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Cadence, Schedule } from '../lib/schedules';
import { MIN_INTERVAL, SCHEDULE_TEMPLATES, describeCadence, formatWhen, scheduleSummary, validateSchedule } from '../lib/schedules';
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon, SmallPlusIcon } from './Icons';
import './Scheduled.css';

type Draft = { title: string; prompt: string; cadence: Cadence };
type Selection = { kind: 'home' } | { kind: 'new'; draft: Draft } | { kind: 'view'; id: string } | { kind: 'edit'; id: string };

interface Props {
  schedules: Schedule[];
  loadFailed?: boolean;
  onRetryLoad?: () => void;
  persistenceFailed?: boolean;
  onRetrySave?: () => void;
  onCreate: (draft: Draft) => string;
  onUpdate: (id: string, draft: Draft) => void;
  onPause: (id: string, paused: boolean) => void;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onOpenChat: (chatId: string) => void;
}

const BLANK: Draft = { title: '', prompt: '', cadence: { kind: 'daily', time: '09:00' } };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Frequency = 'once' | 'interval' | 'hourly' | 'daily' | 'weekly';

const pad = (n: number) => String(n).padStart(2, '0');
const localDateTime = (ms: number) => {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const frequencyOf = (c: Cadence): Frequency => (c.kind === 'interval' && c.minutes === 60 ? 'hourly' : c.kind);
const timeOf = (c: Cadence) => ('time' in c ? c.time : '09:00');

function cadenceFor(frequency: Frequency, current: Cadence): Cadence {
  const time = timeOf(current);
  if (frequency === 'once') return { kind: 'once', at: current.kind === 'once' ? current.at : Date.now() + 60 * 60_000 };
  if (frequency === 'hourly') return { kind: 'interval', minutes: 60 };
  if (frequency === 'interval') return { kind: 'interval', minutes: current.kind === 'interval' && current.minutes !== 60 ? current.minutes : 30 };
  if (frequency === 'daily') return { kind: 'daily', time };
  return { kind: 'weekly', day: current.kind === 'weekly' ? current.day : new Date().getDay(), time };
}

function ScheduleEditor({ initial, heading, onSave, onCancel }: { initial: Draft; heading: string; onSave: (draft: Draft) => void; onCancel: () => void }) {
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLSelectElement>(null);
  const whenRef = useRef<HTMLInputElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [frequency, setFrequency] = useState<Frequency>(frequencyOf(initial.cadence));
  const [error, setError] = useState<string | null>(null);
  const c = draft.cadence;
  const saveFailed = error === 'Unable to save this task. Your draft is still here. Try again.';
  const instructionsInvalid = !!error && (!draft.prompt.trim() || draft.prompt.length > 4000);
  const whenInvalid = !!error && error === 'Pick a time in the future.' && validateSchedule(draft) === error;
  const timeInvalid = !!error && error === 'Pick a time.' && validateSchedule(draft) === error;
  const dayInvalid = error === 'Pick a day.' && validateSchedule(draft) === error;
  const minutesInvalid = !!error && c.kind === 'interval' && (error === `Repeat at least every ${MIN_INTERVAL} minutes.` || error === 'Repeat interval must be 10080 minutes (7 days) or less.') && validateSchedule(draft) === error;
  const set = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null); };
  const submit = () => {
    const problem = validateSchedule(draft);
    if (problem) {
      setError(problem);
      if (!draft.prompt.trim() || draft.prompt.length > 4000) instructionsRef.current?.focus();
      else if (problem === 'Pick a time.') timeRef.current?.focus();
      else if (problem === 'Pick a day.') dayRef.current?.focus();
      else if (problem === 'Pick a time in the future.') whenRef.current?.focus();
      else if (c.kind === 'interval') minutesRef.current?.focus();
    }
    else {
      try {
        onSave(draft);
        setError(null);
      } catch {
        setError('Unable to save this task. Your draft is still here. Try again.');
        instructionsRef.current?.focus();
      }
    }
  };
  return (
    <form className="schedule-editor" aria-labelledby="schedule-editor-title" aria-describedby="schedule-time-zone" noValidate onSubmit={(e) => { if (e.defaultPrevented) return; e.preventDefault(); submit(); }} onKeyDown={(event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submit();
        return;
      }
      if (event.key === 'Enter' && (event.altKey || event.shiftKey) && (event.target as HTMLElement).tagName !== 'TEXTAREA') event.preventDefault();
      if (event.key === 'Enter' && event.repeat && (event.target as HTMLElement).tagName !== 'TEXTAREA') event.preventDefault();
      if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault();
        if (!event.repeat) onCancel();
      }
    }}>
      <h2 id="schedule-editor-title">{heading}</h2>
      <label className="schedule-field">
        <span>Name</span>
        <input autoFocus value={draft.title} placeholder="Morning briefing" maxLength={80} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="schedule-field">
        <span id="schedule-instructions-label">Instructions</span>
        <textarea aria-labelledby="schedule-instructions-label" ref={instructionsRef} aria-invalid={instructionsInvalid || undefined} aria-describedby={instructionsInvalid || saveFailed ? 'schedule-instructions-help schedule-instructions-error' : 'schedule-instructions-help'} value={draft.prompt} rows={5} maxLength={4000} placeholder="What should Jarvis do each time this runs?" onChange={(e) => set({ prompt: e.target.value })} />
        <span id="schedule-instructions-help" className="schedule-note">Press ⌘Enter or Ctrl+Enter to save. Press Escape to cancel without saving.</span>
      </label>
      <div className="schedule-row">
        <label className="schedule-field">
          <span>Repeats</span>
          <select value={frequency} onChange={(e) => {
            const next = e.target.value as Frequency;
            setFrequency(next);
            set({ cadence: cadenceFor(next, c) });
          }}>
            <option value="once">Once</option>
            <option value="interval">Every few minutes</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        {c.kind === 'weekly' && (
          <label className="schedule-field">
            <span>Day</span>
            <select ref={dayRef} aria-invalid={dayInvalid || undefined} aria-describedby={dayInvalid ? 'schedule-instructions-error' : undefined} value={c.day} onChange={(e) => set({ cadence: { ...c, day: Number(e.target.value) } })}>
              {DAY_NAMES.map((name, day) => <option key={name} value={day}>{name}</option>)}
            </select>
          </label>
        )}
        {(c.kind === 'daily' || c.kind === 'weekly') && (
          <label className="schedule-field">
            <span>Time</span>
            <input ref={timeRef} aria-invalid={timeInvalid || undefined} aria-describedby={timeInvalid ? 'schedule-instructions-error' : undefined} type="time" value={c.time} onChange={(e) => set({ cadence: { ...c, time: e.target.value } })} />
          </label>
        )}
        {c.kind === 'interval' && frequency === 'interval' && (
          <label className="schedule-field">
            <span>Minutes</span>
            <input ref={minutesRef} aria-invalid={minutesInvalid || undefined} aria-describedby={minutesInvalid ? 'schedule-instructions-error' : undefined} type="number" min={MIN_INTERVAL} step={5} value={Number.isNaN(c.minutes) ? '' : c.minutes} onChange={(e) => set({ cadence: { kind: 'interval', minutes: e.target.value === '' ? NaN : Number(e.target.value) } })} />
          </label>
        )}
        {c.kind === 'once' && (
          <label className="schedule-field">
            <span>When</span>
            <input ref={whenRef} aria-invalid={whenInvalid || undefined} aria-describedby={whenInvalid ? 'schedule-instructions-error' : undefined} type="datetime-local" value={localDateTime(c.at)} onChange={(e) => set({ cadence: { kind: 'once', at: new Date(e.target.value).getTime() } })} />
          </label>
        )}
      </div>
      {error && <p id="schedule-instructions-error" className="schedule-error" role="alert">{error}</p>}
      <div className="schedule-actions">
        <button type="button" className="schedule-btn" onClick={(event) => { if (!event.defaultPrevented) onCancel(); }}>Cancel</button>
        <button type="submit" className="schedule-btn primary" aria-keyshortcuts="Meta+Enter Control+Enter" aria-describedby={error ? 'schedule-instructions-error' : undefined}>Save</button>
      </div>
      <p id="schedule-time-zone" className="schedule-note">{`Times use your device’s local time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}</p>
    </form>
  );
}

function ScheduleDetail({ schedule, onEdit, onPause, onDelete, onRunNow, onOpenChat }: {
  schedule: Schedule; onEdit: () => void; onPause: (paused: boolean) => void; onDelete: () => void; onRunNow: () => void; onOpenChat: (chatId: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const [armed, setArmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    window.addEventListener('blur', disarm);
    return () => window.removeEventListener('blur', disarm);
  }, [armed]);
  const openConversation = () => {
    if (!schedule.chatId) return;
    try {
      onOpenChat(schedule.chatId);
      setActionError(null);
    } catch {
      setActionError('Unable to open this conversation. Try again.');
    }
  };
  const runNow = () => {
    try {
      onRunNow();
      setActionError(null);
    } catch {
      setActionError('Unable to start this task. Try again.');
    }
  };
  const togglePause = () => {
    try {
      onPause(!schedule.paused);
      setActionError(null);
    } catch {
      setActionError('Unable to change this task. Try again.');
    }
  };
  const deleteSchedule = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    try {
      onDelete();
      setActionError(null);
    } catch {
      setArmed(false);
      setActionError('Unable to delete this task. Try again.');
    }
  };
  return (
    <section className="schedule-detail" aria-labelledby="schedule-title" onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      setArmed(false);
    }}>
      <h2 ref={headingRef} tabIndex={-1} id="schedule-title">{schedule.title}</h2>
      <dl>
        <div><dt>Repeats</dt><dd>{describeCadence(schedule.cadence)}</dd></div>
        <div><dt>Next run</dt><dd>{schedule.paused ? 'Paused' : schedule.nextRunAt === null ? 'Not scheduled' : formatWhen(schedule.nextRunAt)}</dd></div>
        {schedule.lastRunAt && <div><dt>Last run</dt><dd>{formatWhen(schedule.lastRunAt)}</dd></div>}
      </dl>
      <h3>Instructions</h3>
      <p className="schedule-prompt">{schedule.prompt}</p>
      <div className="schedule-actions start">
        {schedule.chatId && <button aria-describedby={actionError ? 'schedule-action-error' : undefined} className="schedule-btn primary" onClick={openConversation}>Open conversation</button>}
        <button aria-describedby={actionError ? 'schedule-action-error' : undefined} className="schedule-btn" onClick={runNow} onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }}>Run now</button>
        <button aria-describedby={actionError ? 'schedule-action-error' : undefined} className="schedule-btn" onClick={onEdit}>Edit</button>
        {schedule.nextRunAt !== null && <button aria-describedby={actionError ? 'schedule-action-error' : undefined} className="schedule-btn" onClick={togglePause} onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }}>{schedule.paused ? 'Resume' : 'Pause'}</button>}
        <button aria-describedby={[actionError && 'schedule-action-error', armed && 'schedule-delete-confirmation'].filter(Boolean).join(' ') || undefined} className={`schedule-btn danger${armed ? ' armed' : ''}`} onClick={deleteSchedule} onBlur={() => setArmed(false)} onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
        }}>
          {armed ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
      {actionError && <p id="schedule-action-error" className="schedule-error" role="alert">{actionError}</p>}
      <p id="schedule-delete-confirmation" className="schedule-note" role="status" aria-atomic={true}>{armed ? 'Activate Confirm delete to delete this scheduled task. Press Escape or move focus away to cancel.' : ''}</p>
    </section>
  );
}

/** Scheduled tasks: a list of schedules beside templates, an editor, or the selected schedule. */
export function ScheduledView(p: Props) {
  const newTaskRef = useRef<HTMLButtonElement>(null);
  const selectedTaskRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'home' });
  const [pausedOpen, setPausedOpen] = useState(false);
  const active = p.schedules.filter((s) => !s.paused && s.nextRunAt !== null).sort((a, b) => a.nextRunAt! - b.nextRunAt!);
  const inactive = p.schedules.filter((s) => s.paused || s.nextRunAt === null);
  const selectedId = selection.kind === 'view' || selection.kind === 'edit' ? selection.id : null;
  const selected = p.schedules.find((s) => s.id === selectedId);

  const item = (s: Schedule) => (
    <button key={s.id} ref={s.id === selectedId ? selectedTaskRef : undefined} className={`schedule-item${s.id === selectedId ? ' active' : ''}`} aria-current={s.id === selectedId ? 'true' : undefined} onClick={() => setSelection({ kind: 'view', id: s.id })}>
      <span className="schedule-item-title">{s.title}</span>
      <span className="schedule-item-meta">{scheduleSummary(s)}</span>
    </button>
  );

  let body: ReactNode;
  if (selection.kind === 'new') {
    body = <ScheduleEditor key={JSON.stringify(selection.draft)} heading="New task" initial={selection.draft} onCancel={() => { setSelection({ kind: 'home' }); newTaskRef.current?.focus(); }} onSave={(draft) => { setSelection({ kind: 'view', id: p.onCreate(draft) }); newTaskRef.current?.focus(); }} />;
  } else if (selection.kind === 'edit' && selected) {
    body = <ScheduleEditor key={selected.id} heading="Edit task" initial={selected} onCancel={() => { setSelection({ kind: 'view', id: selected.id }); selectedTaskRef.current?.focus(); }} onSave={(draft) => { p.onUpdate(selected.id, draft); setSelection({ kind: 'view', id: selected.id }); selectedTaskRef.current?.focus(); }} />;
  } else if (selection.kind === 'view' && selected) {
    body = <ScheduleDetail key={selected.id} schedule={selected} onEdit={() => setSelection({ kind: 'edit', id: selected.id })} onPause={(paused) => { p.onPause(selected.id, paused); if (paused) setPausedOpen(true); }} onDelete={() => { p.onDelete(selected.id); setSelection({ kind: 'home' }); newTaskRef.current?.focus(); }} onRunNow={() => p.onRunNow(selected.id)} onOpenChat={p.onOpenChat} />;
  } else {
    body = (
      <div className="schedule-home">
        <div className="schedule-hero">
          <span className="schedule-hero-icon"><HistoryIcon /></span>
          <h2>Schedule a task</h2>
          <p>Jarvis can take care of ongoing tasks so you don’t have to.</p>
        </div>
        <div className="schedule-templates">
          {SCHEDULE_TEMPLATES.map((t) => (
            <button key={t.title} className="schedule-template" onClick={() => setSelection({ kind: 'new', draft: { title: t.title, prompt: t.prompt, cadence: t.cadence } })}>
              <span className="schedule-template-icon" aria-hidden="true">{t.icon}</span>
              <span>
                <strong>{t.title}</strong>
                <span>{t.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (p.loadFailed) return (
    <div className="scheduled">
      <nav className="schedule-list" aria-label="Scheduled tasks">
        <h1 className="schedule-heading drag-region">Scheduled</h1>
        <div className="schedule-error" role="alert">
          <p>Scheduled tasks could not be loaded. Your saved tasks have not been changed.</p>
          <button className="schedule-btn" onClick={p.onRetryLoad}>Retry loading</button>
        </div>
      </nav>
    </div>
  );

  return (
    <div className="scheduled">
        <nav className="schedule-list" aria-label="Scheduled tasks">
          <h1 className="schedule-heading drag-region">Scheduled</h1>
          <button ref={newTaskRef} className="schedule-new" onClick={() => setSelection({ kind: 'new', draft: BLANK })}>
            <SmallPlusIcon />
            <span>New task</span>
          </button>
          <p className="schedule-note">Scheduled tasks run while Jarvis is open. Runs missed while it was closed happen once when you reopen it. Schedule times use your computer’s local time zone.</p>
          {p.persistenceFailed && <div className="schedule-error" role="alert">
            <p>Schedule changes could not be saved. They may be lost when Jarvis closes.</p>
            <button className="schedule-btn" onClick={p.onRetrySave}>Retry saving</button>
          </div>}
          <div className="schedule-section">Active</div>
          {active.length ? active.map(item) : <p className="schedule-empty">{inactive.length ? 'No active tasks. View paused or completed tasks below, or create a new task.' : 'No scheduled tasks yet. Start from a template or create your own.'}</p>}
          {inactive.length > 0 && (
            <>
              <button className="schedule-section toggle" aria-expanded={pausedOpen} onClick={() => setPausedOpen((o) => !o)}>
                Paused or completed {pausedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </button>
              {pausedOpen && inactive.map(item)}
            </>
          )}
        </nav>
        <div className="schedule-main">
          <div className="schedule-drag drag-region" />
          {body}
        </div>
    </div>
  );
}
