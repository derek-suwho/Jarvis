const { targetKey } = require('./coordinator.cjs');

function createTaskNotifications({ isFocused, openTarget, createNotification }) {
  const delivered = new Set();
  const live = new Map();
  let enabled = true;
  return {
    setPreferences(preferences) { enabled = preferences.desktopTaskNotifications; },
    outcome(task) {
      if (delivered.has(task.id) || !['complete', 'failed'].includes(task.state)) return;
      delivered.add(task.id);
      if (delivered.size > 1000) delivered.delete(delivered.values().next().value);
      if (!enabled || !task.unread || task.target.ephemeral || isFocused()) return;
      let notification;
      try {
        notification = createNotification({ title: 'Jarvis',
          body: task.state === 'complete' ? 'A task finished in Jarvis' : 'A task needs attention in Jarvis', silent: true });
        if (!notification) return;
        const entry = { notification, target: task.target };
        live.set(task.id, entry);
        notification.on('click', () => { if (live.get(task.id) === entry) openTarget(task.target); });
        const release = () => { if (live.get(task.id) === entry) live.delete(task.id); };
        notification.on('close', release);
        notification.on('failed', release);
        notification.show();
      } catch {
        live.delete(task.id);
        // Native delivery is best effort; the task's unread outcome remains in the app.
      }
    },
    forgetTarget(target) {
      for (const [id, entry] of live) {
        if (targetKey(entry.target) !== targetKey(target)) continue;
        live.delete(id);
        entry.notification.close();
      }
    },
  };
}

module.exports = { createTaskNotifications };
