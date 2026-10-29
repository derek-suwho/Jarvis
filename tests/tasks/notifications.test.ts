import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createTaskNotifications } = require('../../electron/tasks/notifications.cjs');

describe('task outcome notifications', () => {
  function harness() {
    const created: any[] = [], open = vi.fn(); let focused = false;
    const service = createTaskNotifications({ isFocused: () => focused, openTarget: open,
      createNotification: (options: any) => {
        const n = Object.assign(new EventEmitter(), { show: vi.fn(), close: vi.fn(), options }); created.push(n); return n;
      } });
    const task = { id: 'task', state: 'complete', unread: true, target: { kind: 'chat', id: 'a', generation: 'a', ephemeral: false } };
    return { service, created, open, task, focus: () => { focused = true; } };
  }
  it('notifies once with generic silent content and routes click', () => {
    const h = harness(); h.service.outcome(h.task); h.service.outcome(h.task);
    expect(h.created).toHaveLength(1); expect(h.created[0].show).toHaveBeenCalledOnce();
    expect(h.created[0].options).toEqual({ title: 'Jarvis', body: 'A task finished in Jarvis', silent: true });
    h.created[0].emit('click'); expect(h.open).toHaveBeenCalledWith(h.task.target);
  });
  it('suppresses focused, read, ephemeral, cancelled and preference-disabled alerts', () => {
    for (const patch of [{ unread: false }, { state: 'cancelled' }, { target: { ephemeral: true } }]) {
      const h = harness(); h.service.outcome({ ...h.task, ...patch }); expect(h.created).toHaveLength(0);
    }
    const h = harness(); h.focus(); h.service.outcome(h.task); expect(h.created).toHaveLength(0);
    const off = harness(); off.service.setPreferences({ desktopTaskNotifications: false }); off.service.outcome(off.task); expect(off.created).toHaveLength(0);
  });
  it('handles native failure and closes removed-target notifications', () => {
    const h = harness(); h.service.outcome(h.task); expect(() => h.created[0].emit('failed', 'unsigned')).not.toThrow();
    const second = harness(); second.service.outcome(second.task); second.service.forgetTarget(second.task.target);
    expect(second.created[0].close).toHaveBeenCalledOnce();
    second.created[0].emit('click'); expect(second.open).not.toHaveBeenCalled();
  });
});
