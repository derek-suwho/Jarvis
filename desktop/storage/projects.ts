import { randomUUID } from 'node:crypto';
import type { ProjectRecord } from '../../src/shared/domain';
import type { Database } from './database';
import { reconcileMemory } from './memory';
import { createCheckpointStore } from './checkpoints';

type ProjectRow = { id: string; name: string; aliases_json: string; created_at: string };
const record = (row: ProjectRow): ProjectRecord => ({ id: row.id, name: row.name, aliases: JSON.parse(row.aliases_json) as string[], createdAt: row.created_at });

export function createProjectStore(db: Database) {
  return {
    list(): ProjectRecord[] { return (db.prepare('SELECT * FROM projects ORDER BY created_at, rowid').all() as ProjectRow[]).map(record); },
    get(id: string): ProjectRecord | null { const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined; return row ? record(row) : null; },
    create(name: string, aliases: string[]): ProjectRecord {
      if (typeof name !== 'string' || !name.trim() || !Array.isArray(aliases) || aliases.some(a => typeof a !== 'string' || !a.trim())) throw new Error('Invalid project');
      const project = { id: randomUUID(), name: name.trim(), aliases: [...new Set(aliases.map(a => a.trim()))], createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO projects(id, name, aliases_json, created_at) VALUES (?, ?, ?, ?)').run(project.id, project.name, JSON.stringify(project.aliases), project.createdAt);
      return project;
    },
    delete(id: string): void {
      db.transaction(() => {
        // The renderer archive is independent of normalized chat foreign keys.
        // Purge it before cascading away the captured scope and attempt IDs.
        const checkpoints = createCheckpointStore(db);
        const archive = checkpoints.load();
        if (archive !== null) {
          const ownedChats = new Set((db.prepare('SELECT id FROM chats WHERE project_id = ?').all(id) as { id: string }[]).map(row => row.id));
          // Retry descendants cascade with their original run even if the chat
          // moved before retry. Mirror that closure in the independent archive.
          const captured = db.prepare(`WITH RECURSIVE removed(id) AS (
            SELECT id FROM runs WHERE project_id = ?
            UNION
            SELECT r.id FROM runs r JOIN removed parent ON r.retry_of = parent.id
          ) SELECT r.chat_id, r.request_id, r.user_message_id, r.assistant_message_id
            FROM runs r JOIN removed ON r.id = removed.id`).all(id) as { chat_id: string; request_id: string; user_message_id: string; assistant_message_id: string }[];
          const affectedChats = new Set(captured.map(row => row.chat_id));
          const attempts = new Set(captured.map(row => row.request_id));
          const messageIds = new Set(captured.flatMap(row => [row.user_message_id, row.assistant_message_id]));
          checkpoints.save(archive.filter(chat => chat.projectId !== id && !ownedChats.has(chat.id)).map(chat => {
            if (!affectedChats.has(chat.id)) return chat;
            return { ...chat, title: 'New chat', messages: chat.messages.filter(message => !messageIds.has(message.id) && (!message.attemptId || !attempts.has(message.attemptId))) };
          }));
        }
        // Captured turn scope can outlive chat moves. Remove its evidence before
        // deleting the project, including summaries derived from those turns.
        db.prepare('DELETE FROM memory_summaries WHERE chat_id IN (SELECT chat_id FROM runs WHERE project_id = ?)').run(id);
        db.prepare("UPDATE chats SET title = 'New chat' WHERE id IN (SELECT chat_id FROM runs WHERE project_id = ?)").run(id);
        db.prepare('DELETE FROM runs WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        reconcileMemory(db);
      }).immediate();
    },
  };
}
export type ProjectStore = ReturnType<typeof createProjectStore>;
