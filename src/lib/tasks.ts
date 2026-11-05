import type { TaskEvent, TaskResult, TaskSnapshot, TasksBridge, TaskTarget } from '../shared/tasks';
import { createPreviewTasksBridge } from './previewTasks';

export function createTaskClient(bridge: TasksBridge) {
  let snapshots: TaskSnapshot[] = [];
  let connecting: Promise<void> | undefined;
  const revisions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const forgottenTargets = new Set<string>();
  const targetKey = (target: TaskTarget) => JSON.stringify([target.kind, target.id, target.generation]);
  const publish = (event: TaskEvent) => {
    const target = event.type === 'snapshot' ? event.task.target : event.target;
    if (forgottenTargets.has(targetKey(target))) return;
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
      // Callers also project successful receipts directly into renderer history.
      // A forgotten generation must lose that authority as well as publication.
      if (result.ok && forgottenTargets.has(targetKey(result.task.target))) {
        return { ok: false, code: 'target_forgotten', message: 'This conversation was deleted. Start a new chat to continue.' };
      }
      if (result.ok) publish({ type: 'snapshot', task: result.task });
      return result;
    } catch (error) {
      return { ok: false, code: 'transport_error', message: error instanceof Error ? error.message : 'Could not reach the task. Your message is still here.' };
    }
  };
  return {
    bridge,
    /** Fence before IPC yields; failures stay fenced so private output cannot reappear.
     * Callers can retry deletion; restored chats must use a new generation.
     */
    forgetTarget(target: TaskTarget, preserveHistory = false): Promise<void> {
      const key = targetKey(target);
      forgottenTargets.add(key);
      snapshots = snapshots.filter((task) => targetKey(task.target) !== key);
      listeners.forEach((listener) => listener());
      return preserveHistory ? bridge.forgetTarget(target, true) : bridge.forgetTarget(target);
    },
    connect(): Promise<void> {
      if (!connecting) {
        let active = true;
        const unsubscribe = bridge.onEvent((event) => {
          if (active) publish(event);
        });
        connecting = bridge.snapshot()
          .then((tasks) => tasks.forEach((task) => publish({ type: 'snapshot', task })))
          .catch((error: unknown) => {
            active = false;
            unsubscribe();
            // Events from an incomplete hydration cannot establish live ownership.
            // Retry must accept the next snapshot and its revision sequence afresh.
            snapshots = [];
            revisions.clear();
            connecting = undefined;
            listeners.forEach((listener) => listener());
            throw error;
          });
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
