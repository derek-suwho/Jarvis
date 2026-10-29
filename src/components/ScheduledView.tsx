import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Cadence, Schedule } from '../lib/schedules';
import { MIN_INTERVAL, SCHEDULE_TEMPLATES, describeCadence, formatWhen, scheduleSummary, validateSchedule } from '../lib/schedules';
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon, SmallPlusIcon } from './Icons';
import './Scheduled.css';

type Draft = { title: string; prompt: string; cadence: Cadence };
type Selection = { kind: 'home' } | { kind: 'new'; draft: Draft } | { kind: 'view'; id: string } | { kind: 'edit'; id: string };

interface Props {
  schedules: Schedule[];
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
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const c = draft.cadence;
  const set = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null); };
  const submit = () => {
    const problem = validateSchedule(draft);
    if (problem) setError(problem);
    else onSave(draft);
  };
  return (
    <form className="schedule-editor" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>{heading}</h2>
      <label className="schedule-field">
        <span>Name</span>
        <input value={draft.title} placeholder="Morning briefing" maxLength={80} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="schedule-field">
        <span>Instructions</span>
        <textarea autoFocus value={draft.prompt} rows={5} maxLength={4000} placeholder="What should Jarvis do each time this runs?" onChange={(e) => set({ prompt: e.target.value })} />
      </label>
      <div className="schedule-row">
        <label className="schedule-field">
          <span>Repeats</span>
          <select value={frequencyOf(c)} onChange={(e) => set({ cadence: cadenceFor(e.target.value as Frequency, c) })}>
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
            <select value={c.day} onChange={(e) => set({ cadence: { ...c, day: Number(e.target.value) } })}>
              {DAY_NAMES.map((name, day) => <option key={name} value={day}>{name}</option>)}
            </select>
          </label>
        )}
        {(c.kind === 'daily' || c.kind === 'weekly') && (
          <label className="schedule-field">
            <span>Time</span>
            <input type="time" value={c.time} onChange={(e) => set({ cadence: { ...c, time: e.target.value } })} />
          </label>
        )}
        {c.kind === 'interval' && c.minutes !== 60 && (
          <label className="schedule-field">
            <span>Minutes</span>
            <input type="number" min={MIN_INTERVAL} step={5} value={c.minutes} onChange={(e) => set({ cadence: { kind: 'interval', minutes: Math.round(Number(e.target.value)) } })} />
          </label>
        )}
        {c.kind === 'once' && (
          <label className="schedule-field">
            <span>When</span>
            <input type="datetime-local" value={localDateTime(c.at)} onChange={(e) => set({ cadence: { kind: 'once', at: new Date(e.target.value).getTime() } })} />
          </label>
        )}
      </div>
      {error && <p className="schedule-error" role="alert">{error}</p>}
      <div className="schedule-actions">
        <button type="button" className="schedule-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="schedule-btn primary">Save</button>
      </div>
      <p className="schedule-note">Scheduled tasks run while Jarvis is open. Runs missed while it was closed happen once when you reopen it.</p>
    </form>
  );
}

function ScheduleDetail({ schedule, onEdit, onPause, onDelete, onRunNow, onOpenChat }: {
  schedule: Schedule; onEdit: () => void; onPause: (paused: boolean) => void; onDelete: () => void; onRunNow: () => void; onOpenChat: (chatId: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <section className="schedule-detail" aria-labelledby="schedule-title">
      <h2 id="schedule-title">{schedule.title}</h2>
      <dl>
        <div><dt>Repeats</dt><dd>{describeCadence(schedule.cadence)}</dd></div>
        <div><dt>Next run</dt><dd>{schedule.paused ? 'Paused' : schedule.nextRunAt === null ? 'Not scheduled' : formatWhen(schedule.nextRunAt)}</dd></div>
        {schedule.lastRunAt && <div><dt>Last run</dt><dd>{formatWhen(schedule.lastRunAt)}</dd></div>}
      </dl>
      <h3>Instructions</h3>
      <p className="schedule-prompt">{schedule.prompt}</p>
      <div className="schedule-actions start">
        {schedule.chatId && <button className="schedule-btn primary" onClick={() => onOpenChat(schedule.chatId!)}>Open conversation</button>}
        <button className="schedule-btn" onClick={onRunNow}>Run now</button>
        <button className="schedule-btn" onClick={onEdit}>Edit</button>
        {schedule.nextRunAt !== null && <button className="schedule-btn" onClick={() => onPause(!schedule.paused)}>{schedule.paused ? 'Resume' : 'Pause'}</button>}
        <button className={`schedule-btn danger${armed ? ' armed' : ''}`} onClick={() => (armed ? onDelete() : setArmed(true))} onBlur={() => setArmed(false)}>
          {armed ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
    </section>
  );
}

/** Scheduled tasks: a list of schedules beside templates, an editor, or the selected schedule. */
export function ScheduledView(p: Props) {
  const [selection, setSelection] = useState<Selection>({ kind: 'home' });
  const [pausedOpen, setPausedOpen] = useState(false);
  const active = p.schedules.filter((s) => !s.paused && s.nextRunAt !== null).sort((a, b) => a.nextRunAt! - b.nextRunAt!);
  const inactive = p.schedules.filter((s) => s.paused || s.nextRunAt === null);
  const selectedId = selection.kind === 'view' || selection.kind === 'edit' ? selection.id : null;
  const selected = p.schedules.find((s) => s.id === selectedId);

  const item = (s: Schedule) => (
    <button key={s.id} className={`schedule-item${s.id === selectedId ? ' active' : ''}`} aria-current={s.id === selectedId ? 'true' : undefined} onClick={() => setSelection({ kind: 'view', id: s.id })}>
      <span className="schedule-item-title">{s.title}</span>
      <span className="schedule-item-meta">{scheduleSummary(s)}</span>
    </button>
  );

  let body: ReactNode;
  if (selection.kind === 'new') {
    body = <ScheduleEditor key={JSON.stringify(selection.draft)} heading="New task" initial={selection.draft} onCancel={() => setSelection({ kind: 'home' })} onSave={(draft) => setSelection({ kind: 'view', id: p.onCreate(draft) })} />;
  } else if (selection.kind === 'edit' && selected) {
    body = <ScheduleEditor key={selected.id} heading="Edit task" initial={selected} onCancel={() => setSelection({ kind: 'view', id: selected.id })} onSave={(draft) => { p.onUpdate(selected.id, draft); setSelection({ kind: 'view', id: selected.id }); }} />;
  } else if (selection.kind === 'view' && selected) {
    body = <ScheduleDetail key={selected.id} schedule={selected} onEdit={() => setSelection({ kind: 'edit', id: selected.id })} onPause={(paused) => p.onPause(selected.id, paused)} onDelete={() => { p.onDelete(selected.id); setSelection({ kind: 'home' }); }} onRunNow={() => p.onRunNow(selected.id)} onOpenChat={p.onOpenChat} />;
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

  return (
    <div className="scheduled">
        <nav className="schedule-list" aria-label="Scheduled tasks">
          <h1 className="schedule-heading drag-region">Scheduled</h1>
          <button className="schedule-new" onClick={() => setSelection({ kind: 'new', draft: BLANK })}>
            <SmallPlusIcon />
            <span>New task</span>
          </button>
          <div className="schedule-section">Active</div>
          {active.length ? active.map(item) : <p className="schedule-empty">No scheduled tasks yet. Start from a template or create your own.</p>}
          {inactive.length > 0 && (
            <>
              <button className="schedule-section toggle" aria-expanded={pausedOpen} onClick={() => setPausedOpen((o) => !o)}>
                Paused {pausedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
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
