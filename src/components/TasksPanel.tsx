import type { TaskSnapshot } from '../shared/tasks';
import { isActiveTask } from '../shared/tasks';
import './Tasks.css';

export const taskStateLabel = (task: TaskSnapshot) => ({ queued: 'Waiting', running: 'Working', interrupting: 'Interrupting…', stopping: 'Stopping…', complete: 'Complete', cancelled: 'Stopped', failed: 'Needs attention', interrupted: 'Interrupted' })[task.state];
export function TaskStatus({ task }: { task?: TaskSnapshot }) {
  if (!task || (!isActiveTask(task) && !task.unread)) return null;
  const label = task.unread ? `${taskStateLabel(task)} — unread` : taskStateLabel(task);
  return <span className={`task-indicator${isActiveTask(task) ? ' active' : ' unread'}`} title={label}>
    <span aria-hidden="true" /> <span className="sr-only">{label}</span>
  </span>;
}

