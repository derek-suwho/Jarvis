import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ScheduledView } from '../src/components/ScheduledView';
import type { Schedule } from '../src/lib/schedules';

function render(schedules: Schedule[]) {
  return renderToStaticMarkup(createElement(ScheduledView, { schedules, onCreate: () => '',
    onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() }));
}

it('offers creation guidance for a fresh schedule list', () => {
  const html = render([]);
  expect(html).toContain('No scheduled tasks yet. Start from a template or create your own.');
  expect(html).not.toContain('Paused or completed');
});

it.each([
  { paused: true, nextRunAt: 2000 },
  { paused: false, nextRunAt: null },
])('describes inactive-only schedules honestly: %j', (state) => {
  const html = render([{
    id: 'saved-task', title: 'Saved task', prompt: 'Review updates',
    cadence: { kind: 'once', at: 2000 }, createdAt: 1000, ...state,
  }]);
  expect(html).toContain('No active tasks. View paused or completed tasks below, or create a new task.');
  expect(html).not.toContain('No scheduled tasks yet.');
  expect(html).toContain('Scheduled tasks run while Jarvis is open.');
  expect(html).toMatch(/aria-expanded="false"[^>]*>Paused or completed/);
});

it('discloses open-app and missed-run limitations before choosing a schedule', () => {
  const html = render([]);
  expect(html).toContain('Scheduled tasks run while Jarvis is open. Runs missed while it was closed happen once when you reopen it.');
});

it('reports unavailable schedule storage and offers persistence retry', async () => {
  const { saveSchedules } = await import('../src/lib/schedules');
  const setItem = vi.fn().mockImplementationOnce(() => { throw new Error('private disk details'); });
  vi.stubGlobal('localStorage', { setItem });
  try {
    const onRetrySave = vi.fn();
    const persistenceFailed = !saveSchedules([]);
    const props = { schedules: [], onCreate: () => '', onUpdate: vi.fn(), onPause: vi.fn(),
      onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn(), persistenceFailed, onRetrySave };
    const html = renderToStaticMarkup(createElement(ScheduledView, props));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Schedule changes could not be saved. They may be lost when Jarvis closes.');
    expect(html).not.toContain('private disk details');
    expect(html).toContain('Retry saving');
    expect(saveSchedules([])).toBe(true);
    expect(renderToStaticMarkup(createElement(ScheduledView, { ...props, persistenceFailed: false }))).not.toContain('role="alert"');
  } finally { vi.unstubAllGlobals(); }
});

it('reports failed schedule loading and offers recovery instead of an empty list', async () => {
  const { loadScheduleState } = await import('../src/lib/schedules');
  const getItem = vi.fn().mockImplementationOnce(() => { throw new Error('private read details'); })
    .mockReturnValueOnce('[]');
  vi.stubGlobal('localStorage', { getItem });
  try {
    expect(loadScheduleState()).toEqual({ schedules: [], failed: true });
    const props = { schedules: [], loadFailed: true, onRetryLoad: vi.fn(), onCreate: () => '',
      onUpdate: vi.fn(), onPause: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn(), onOpenChat: vi.fn() };
    const html = renderToStaticMarkup(createElement(ScheduledView, props));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Scheduled tasks could not be loaded. Your saved tasks have not been changed.');
    expect(html).toContain('Retry loading');
    expect(html).not.toContain('No scheduled tasks yet.');
    expect(html).not.toContain('New task');
    expect(html).not.toContain('private read details');
    expect(loadScheduleState()).toEqual({ schedules: [], failed: false });
    expect(renderToStaticMarkup(createElement(ScheduledView, { ...props, loadFailed: false })))
      .toContain('No scheduled tasks yet.');
  } finally { vi.unstubAllGlobals(); }
});

it.each(['{broken', '{}', '[{"id":"incomplete"}]'])('preserves unreadable saved schedule data: %s', async (stored) => {
  const { loadScheduleState } = await import('../src/lib/schedules');
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem });
  try {
    expect(loadScheduleState()).toEqual({ schedules: [], failed: true });
    expect(setItem).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it('discloses the computer-local time basis before choosing a scheduled task', () => {
  expect(render([])).toContain('Schedule times use your computer’s local time zone.');
});
