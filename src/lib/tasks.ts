import type { TaskEvent, TaskResult, TaskSnapshot, TasksBridge } from '../shared/tasks';
import { createPreviewTasksBridge } from './previewTasks';

export function createTaskClient(bridge: TasksBridge) {
  let snapshots: TaskSnapshot[] = [];
  let connecting: Promise<void> | undefined;
  const revisions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const publish = (event: TaskEvent) => {
    const id = event.type === 'snapshot' ? event.task.id : event.taskId;
    const revision = event.type === 'snapshot' ? event.task.revision : event.revision;
    if (revision <= (revisions.get(id) ?? -1)) return;
    revisions.set(id, revision);
    snapshots = event.type === 'removed' ? snapshots.filter((task) => task.id !== id) :
      [...snapshots.filter((task) => task.id !== id), event.task].sort((a, b) => b.createdAt - a.createdAt);
    listeners.forEach((listener) => listener());
  };
  const command = async (operation: () => Promise<TaskResult>): Promise<TaskResult> => {
    try {
      const result = await operation();
      if (result.ok) publish({ type: 'snapshot', task: result.task });
      return result;
    } catch (error) {
      return { ok: false, code: 'transport_error', message: error instanceof Error ? error.message : 'Could not reach the task. Your message is still here.' };
    }
  };
  return {
    bridge,
    connect(): Promise<void> {
      if (!connecting) {
        bridge.onEvent(publish);
        connecting = bridge.snapshot().then((tasks) => tasks.forEach((task) => publish({ type: 'snapshot', task })));
      }
      return connecting;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshots,
    start: (input: Parameters<TasksBridge['start']>[0]) => command(() => bridge.start(input)),
    queue: (input: Parameters<TasksBridge['queue']>[0]) => command(() => bridge.queue(input)),
    removeQueued: (input: Parameters<TasksBridge['removeQueued']>[0]) => command(() => bridge.removeQueued(input)),
    interrupt: (id: string) => command(() => bridge.interrupt(id)),
    stop: (id: string) => command(() => bridge.stop(id)),
  };
}

export type TaskClient = ReturnType<typeof createTaskClient>;
let instance: TaskClient | undefined;
export function getTaskClient(): TaskClient {
  return instance ??= createTaskClient(window.jarvis?.tasks ?? createPreviewTasksBridge());
}
