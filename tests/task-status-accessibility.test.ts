import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskStatus } from '../src/components/TasksPanel';
import type { TaskSnapshot } from '../src/shared/tasks';

it.each([
  ['failed', 'Needs attention'],
  ['interrupted', 'Interrupted'],
  ['complete', 'Complete'],
  ['cancelled', 'Stopped'],
] as const)('exposes the %s outcome alongside unread status to screen readers', (state, label) => {
  const task = { state, unread: true } as TaskSnapshot;
  const html = renderToStaticMarkup(createElement(TaskStatus, { task }));
  expect(html).toContain(`<span class="sr-only">${label} — unread</span>`);
  expect(renderToStaticMarkup(createElement(TaskStatus, { task: { ...task, unread: false } }))).toBe('');
});
