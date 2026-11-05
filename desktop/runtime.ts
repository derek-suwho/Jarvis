import type { TurnInput } from '../src/shared/contracts';
import { openDatabase } from './storage/database';
import { createCheckpointStore } from './storage/checkpoints';
import { createChatStore } from './storage/chats';
import { createProjectStore } from './storage/projects';
import { createRunStore } from './storage/runs';
import { createMemoryStore } from './storage/memory';
import { createMemoryQueue, type MemoryQueueDependencies } from './memory/queue';

/** Main-process entry point. The renderer never receives the database or its path. */
export function openDesktopStorage(
  path: string,
  options?: Pick<MemoryQueueDependencies, 'getAdapter'>,
) {
  const db = openDatabase(path);
  const runs = createRunStore(db);
  runs.recoverInterrupted();
  const memory = createMemoryStore(db);
  const chats = createChatStore(db);
  const projects = createProjectStore(db);
  const queue = options ? createMemoryQueue({ db, memory, getAdapter: options.getAdapter }) : null;
  queue?.resume();
  return {
    // The coordinator supplies only the current accepted user input, never history
    // or conversation instructions. Existing renderer IDs identify durable chats.
    beginShippingTurn(input: TurnInput, project?: { id: string; name: string } | null) {
      return db.transaction(() => {
        const timestamp = new Date().toISOString();
        if (project) {
          if (!/^[\w:-]{1,120}$/.test(project.id) || typeof project.name !== 'string'
            || !project.name.trim() || project.name.length > 500) throw new Error('Invalid project scope');
          db.prepare('INSERT INTO projects(id, name, aliases_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
            .run(project.id, project.name.trim(), '[]', timestamp);
        }
        db.prepare("INSERT OR IGNORE INTO chats(id, project_id, title, updated_at) VALUES (?, ?, 'New chat', ?)")
          .run(input.chatId, project?.id ?? null, timestamp);
        // Omitted scope preserves backend callers; explicit null means Recents.
        if (project !== undefined) db.prepare('UPDATE chats SET project_id = ? WHERE id = ?')
          .run(project?.id ?? null, input.chatId);
        return runs.begin(input);
      }).immediate();
    },
    checkpoints: createCheckpointStore(db),
    projects: {
      ...projects,
      delete(projectId: string): void | Promise<void> {
        // Abort synchronously, then remove jobs before the worker can claim more.
        // Scope comes from the captured job, even when its chat has moved.
        const cancelled = queue?.cancelProject(projectId);
        projects.delete(projectId);
        return cancelled;
      },
    },
    chats: {
      ...chats,
      delete(chatId: string): void | Promise<void> {
        if (queue) return queue.cancelChat(chatId).then(() => {
          try {
            chats.delete(chatId);
          } finally {
            // A committed deletion has removed its jobs; rollback preserves them.
            // Neither outcome needs a session-lifetime claim exclusion.
            queue.resumeChat(chatId);
          }
        });
        chats.delete(chatId);
      },
    },
    runs: {
      ...runs,
      finish(...args: Parameters<typeof runs.finish>): void {
        // Commit completion and its extraction handoff together, including on retry.
        db.transaction(() => {
          runs.finish(...args);
          const saved = runs.get(args[0]);
          if (saved?.state === 'complete') memory.enqueue(saved);
        }).immediate();
        const saved = runs.get(args[0]);
        if (saved?.state === 'complete') queue?.enqueue(saved);
      },
    },
    memory,
    drainForContext: queue?.drainForContext,
    close(): void | Promise<void> {
      const closeDatabase = () => { if (db.open) db.close(); };
      if (queue) return queue.stop().then(closeDatabase);
      closeDatabase();
    },
  };
}
