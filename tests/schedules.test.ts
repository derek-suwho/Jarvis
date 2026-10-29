import { describe, expect, it } from 'vitest';
import {
  createSchedule,
  describeCadence,
  dueSchedules,
  formatWhen,
  markRan,
  nextRun,
  setPaused,
  validateSchedule,
} from '../src/lib/schedules';

// Wednesday Oct 28 2026, 4:24 PM local time.
const now = new Date(2026, 9, 28, 16, 24).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('nextRun', () => {
  it('runs daily tasks later today, or tomorrow once the time has passed', () => {
    expect(nextRun({ kind: 'daily', time: '18:00' }, now)).toBe(at(28, 18));
    expect(nextRun({ kind: 'daily', time: '08:00' }, now)).toBe(at(29, 8));
  });

  it('runs weekly tasks on the next matching day', () => {
    expect(nextRun({ kind: 'weekly', day: 5, time: '09:00' }, now)).toBe(at(30, 9));
    expect(nextRun({ kind: 'weekly', day: 3, time: '09:00' }, now)).toBe(at(28 + 7, 9));
    expect(nextRun({ kind: 'weekly', day: 3, time: '17:00' }, now)).toBe(at(28, 17));
  });

  it('spaces interval tasks from the last run', () => {
    expect(nextRun({ kind: 'interval', minutes: 20 }, now)).toBe(now + 20 * 60_000);
  });

  it('runs one-time tasks once', () => {
    expect(nextRun({ kind: 'once', at: at(29, 9) }, now)).toBe(at(29, 9));
    expect(nextRun({ kind: 'once', at: at(29, 9) }, at(29, 9))).toBeNull();
  });
});

describe('describing schedules', () => {
  it('labels cadences like ChatGPT', () => {
    expect(describeCadence({ kind: 'interval', minutes: 60 })).toBe('Hourly');
    expect(describeCadence({ kind: 'interval', minutes: 20 })).toBe('Every 20 minutes');
    expect(describeCadence({ kind: 'daily', time: '08:00' })).toBe('Daily at 8 AM');
    expect(describeCadence({ kind: 'weekly', day: 5, time: '18:30' })).toBe('Fridays at 6:30 PM');
  });

  it('labels run times relative to today', () => {
    expect(formatWhen(at(28, 16, 44), now)).toBe('Today 4:44 PM');
    expect(formatWhen(at(29, 8), now)).toBe('Tomorrow 8 AM');
    expect(formatWhen(at(30, 18), now)).toBe('Friday 6 PM');
  });
});

describe('schedule lifecycle', () => {
  const daily = createSchedule({ title: ' Morning ', prompt: 'Brief me', cadence: { kind: 'daily', time: '08:00' } }, now);

  it('validates drafts', () => {
    expect(validateSchedule({ title: '', prompt: ' ', cadence: { kind: 'daily', time: '08:00' } }, now)).toMatch(/Describe/);
    expect(validateSchedule({ title: '', prompt: 'x', cadence: { kind: 'once', at: now - 1 } }, now)).toMatch(/future/);
    expect(validateSchedule({ title: '', prompt: 'x', cadence: { kind: 'interval', minutes: 1 } }, now)).toMatch(/at least/);
    expect(validateSchedule({ title: '', prompt: 'x', cadence: { kind: 'daily', time: '08:00' } }, now)).toBeNull();
  });

  it('creates, runs, and pauses schedules', () => {
    expect(daily.title).toBe('Morning');
    expect(daily.nextRunAt).toBe(at(29, 8));
    expect(dueSchedules([daily], at(29, 8))).toEqual([daily]);
    const ran = markRan(daily, at(29, 8), 'chat-1');
    expect(ran).toMatchObject({ lastRunAt: at(29, 8), nextRunAt: at(30, 8), chatId: 'chat-1' });
    expect(dueSchedules([setPaused(daily, true, now)], at(29, 8))).toEqual([]);
    expect(setPaused(setPaused(daily, true, now), false, at(29, 9)).nextRunAt).toBe(at(30, 8));
  });

  it('names untitled schedules from the prompt', () => {
    expect(createSchedule({ title: '', prompt: 'Check the weather', cadence: { kind: 'interval', minutes: 60 } }, now).title).toBe('Check the weather');
  });
});
