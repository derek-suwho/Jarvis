import { newId } from './chats';

/** How often a scheduled task runs. Times are local "HH:MM"; days are 0 (Sunday) to 6. */
export type Cadence =
  | { kind: 'once'; at: number }
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; day: number; time: string };

/** A prompt Jarvis sends on a schedule; each run lands in the schedule's own conversation. */
export interface Schedule {
  id: string;
  title: string;
  prompt: string;
  cadence: Cadence;
  paused: boolean;
  createdAt: number;
  /** Null once a one-time task has run. */
  nextRunAt: number | null;
  lastRunAt?: number;
  chatId?: string;
}

export interface ScheduleTemplate {
  icon: string;
  title: string;
  detail: string;
  prompt: string;
  cadence: Cadence;
}

const STORAGE_KEY = 'jarvis.schedules';
const TITLE_MAX = 80;
const PROMPT_MAX = 4000;
export const MIN_INTERVAL = 5;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  { icon: '📰', title: 'Morning briefing', detail: 'Summarize the news I should know about each morning.', prompt: 'Give me a short briefing on the most important news today, with one line on why each item matters.', cadence: { kind: 'daily', time: '08:00' } },
  { icon: '📅', title: 'Track deadlines', detail: 'Review my upcoming deadlines each week, with what to prepare.', prompt: 'Ask me about my upcoming deadlines this week, then help me plan what to prepare for each.', cadence: { kind: 'weekly', day: 1, time: '09:00' } },
  { icon: '🔔', title: 'Follow a topic', detail: 'Alert me to big changes in a subject I care about.', prompt: 'Check for any big developments in a topic I care about and summarize what changed. Ask me for the topic if you do not know it yet.', cadence: { kind: 'daily', time: '12:00' } },
  { icon: '🌤️', title: 'Check the weather', detail: 'Show me a three-day forecast each morning.', prompt: 'Give me a three-day weather forecast for my area and anything I should plan around.', cadence: { kind: 'daily', time: '07:00' } },
  { icon: '📖', title: 'Find weekend reads', detail: 'Send me a great article to read every Saturday.', prompt: 'Recommend one great long-form article to read this weekend, with a two-sentence summary of why it is worth it.', cadence: { kind: 'weekly', day: 6, time: '09:00' } },
  { icon: '🎬', title: 'What to watch', detail: 'Pick three movies or shows for me every Friday night.', prompt: 'Pick three movies or shows for me to watch tonight, with a one-line pitch for each.', cadence: { kind: 'weekly', day: 5, time: '18:00' } },
  { icon: '💪', title: 'Workout plan', detail: 'Plan a short workout for me every weekday morning.', prompt: 'Plan a 30-minute workout for me today that needs no equipment.', cadence: { kind: 'daily', time: '06:30' } },
  { icon: '🛍️', title: 'Review spending', detail: 'Help me check my spending every Sunday and suggest ways to save.', prompt: 'Help me review my spending this week. Ask what I spent on, then suggest a few ways I could save.', cadence: { kind: 'weekly', day: 0, time: '17:00' } },
  { icon: '💡', title: 'Learn something new', detail: 'Teach me one interesting idea every day.', prompt: 'Teach me one interesting idea from science, history, or economics in under 200 words.', cadence: { kind: 'daily', time: '10:00' } },
  { icon: '✍️', title: 'Weekly reflection', detail: 'Prompt me to reflect on my week every Friday.', prompt: 'Ask me three short questions to reflect on how my week went and what I want to change next week.', cadence: { kind: 'weekly', day: 5, time: '16:00' } },
];

const validTime = (time: unknown): time is string => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

function atTime(base: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** First run strictly after `after`, or null when the task will not run again. */
export function nextRun(cadence: Cadence, after: number): number | null {
  if (cadence.kind === 'once') return cadence.at > after ? cadence.at : null;
  if (cadence.kind === 'interval') return after + Math.max(MIN_INTERVAL, cadence.minutes) * 60_000;
  const candidate = atTime(new Date(after), cadence.time);
  if (cadence.kind === 'daily') {
    if (candidate.getTime() <= after) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  candidate.setDate(candidate.getDate() + ((cadence.day - candidate.getDay() + 7) % 7));
  if (candidate.getTime() <= after) candidate.setDate(candidate.getDate() + 7);
  return candidate.getTime();
}

export function formatClock(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = date.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

const clockFor = (time: string) => formatClock(atTime(new Date(), time));

export function describeCadence(cadence: Cadence): string {
  if (cadence.kind === 'once') return 'Once';
  if (cadence.kind === 'interval') {
    if (cadence.minutes === 60) return 'Hourly';
    return cadence.minutes % 60 === 0 ? `Every ${cadence.minutes / 60} hours` : `Every ${cadence.minutes} minutes`;
  }
  if (cadence.kind === 'daily') return `Daily at ${clockFor(cadence.time)}`;
  return `${DAYS[cadence.day]}s at ${clockFor(cadence.time)}`;
}

/** "Today 4:24 PM", "Tomorrow 8 AM", "Friday 6 PM", or "Nov 3 9 AM". */
export function formatWhen(at: number, now = Date.now()): string {
  const date = new Date(at);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(date) - start(new Date(now))) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 && days < 7 ? DAYS[date.getDay()]
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} ${formatClock(date)}`;
}

export function scheduleSummary(schedule: Schedule, now = Date.now()): string {
  const cadence = describeCadence(schedule.cadence);
  if (schedule.paused) return `Paused · ${cadence}`;
  if (schedule.nextRunAt === null) return schedule.lastRunAt ? `Ran ${formatWhen(schedule.lastRunAt, now)}` : 'Finished';
  return `${formatWhen(schedule.nextRunAt, now)} · ${cadence}`;
}

/** Returns an error message, or null when the draft can be saved. */
export function validateSchedule(draft: { title: string; prompt: string; cadence: Cadence }, now = Date.now()): string | null {
  if (!draft.prompt.trim()) return 'Describe what Jarvis should do.';
  if (draft.prompt.length > PROMPT_MAX) return `Instructions must be under ${PROMPT_MAX} characters.`;
  const c = draft.cadence;
  if (c.kind === 'once' && !(Number.isFinite(c.at) && c.at > now)) return 'Pick a time in the future.';
  if (c.kind === 'interval' && !(Number.isInteger(c.minutes) && c.minutes >= MIN_INTERVAL && c.minutes <= 7 * 24 * 60)) return `Repeat at least every ${MIN_INTERVAL} minutes.`;
  if ((c.kind === 'daily' || c.kind === 'weekly') && !validTime(c.time)) return 'Pick a time.';
  if (c.kind === 'weekly' && !(Number.isInteger(c.day) && c.day >= 0 && c.day <= 6)) return 'Pick a day.';
  return null;
}

export function createSchedule(draft: { title: string; prompt: string; cadence: Cadence }, now = Date.now()): Schedule {
  const prompt = draft.prompt.trim().slice(0, PROMPT_MAX);
  const title = draft.title.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX) || prompt.replace(/\s+/g, ' ').slice(0, 40);
  return { id: newId(), title, prompt, cadence: draft.cadence, paused: false, createdAt: now, nextRunAt: nextRun(draft.cadence, now) };
}

/** Applies an edit, recomputing the next run from now. */
export function editSchedule(schedule: Schedule, draft: { title: string; prompt: string; cadence: Cadence }, now = Date.now()): Schedule {
  const next = createSchedule(draft, now);
  return { ...schedule, title: next.title, prompt: next.prompt, cadence: next.cadence, nextRunAt: next.nextRunAt };
}

export function setPaused(schedule: Schedule, paused: boolean, now = Date.now()): Schedule {
  return { ...schedule, paused, nextRunAt: paused ? schedule.nextRunAt : nextRun(schedule.cadence, now) };
}

/** Active schedules whose next run has arrived; missed runs while Jarvis was closed run once. */
export function dueSchedules(schedules: Schedule[], now = Date.now()): Schedule[] {
  return schedules.filter((s) => !s.paused && s.nextRunAt !== null && s.nextRunAt <= now);
}

export function markRan(schedule: Schedule, now = Date.now(), chatId?: string): Schedule {
  return { ...schedule, lastRunAt: now, nextRunAt: nextRun(schedule.cadence, now), ...(chatId ? { chatId } : {}) };
}

function isCadence(v: unknown): v is Cadence {
  const c = v as Cadence;
  if (!c || typeof c !== 'object') return false;
  if (c.kind === 'once') return Number.isFinite(c.at);
  if (c.kind === 'interval') return Number.isInteger(c.minutes) && c.minutes >= MIN_INTERVAL;
  if (c.kind === 'daily') return validTime(c.time);
  return c.kind === 'weekly' && validTime(c.time) && Number.isInteger(c.day) && c.day >= 0 && c.day <= 6;
}

function isSchedule(v: unknown): v is Schedule {
  const s = v as Schedule;
  return !!s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.prompt === 'string'
    && typeof s.paused === 'boolean' && (s.nextRunAt === null || Number.isFinite(s.nextRunAt)) && isCadence(s.cadence);
}

export function loadSchedules(): Schedule[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSchedule) : [];
  } catch {
    return [];
  }
}

export function saveSchedules(schedules: Schedule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  } catch {
    // Storage unavailable — keep in memory only.
  }
}
