import { randomUUID } from 'node:crypto';
import type { ChatRecord, ChatSnapshot, MessageRecord } from '../../src/shared/domain';
import type { Role } from '../../src/shared/contracts';
import type { Database } from './database';
import { reconcileMemory } from './memory';
import { createRunStore } from './runs';

type ChatRow = { id: string; project_id: string | null; title: string; updated_at: string };
type MessageRow = { sequence: number; id: string; chat_id: string; role: Role; content: string; created_at: string; run_id: string | null };
const record = (row: ChatRow): ChatRecord => ({ id: row.id, projectId: row.project_id, title: row.title, updatedAt: row.updated_at });

export function createChatStore(db: Database) {
  return {
    list(projectId?: string | null): ChatRecord[] {
      const sql = 'SELECT * FROM chats' + (projectId === undefined ? '' : ' WHERE project_id IS ?') + ' ORDER BY updated_at DESC, rowid DESC';
      return (db.prepare(sql).all(...(projectId === undefined ? [] : [projectId])) as ChatRow[]).map(record);
    },
    create(projectId: string | null): ChatRecord {
      const chat = { id: randomUUID(), projectId, title: 'New chat', updatedAt: new Date().toISOString() };
      db.prepare('INSERT INTO chats(id, project_id, title, updated_at) VALUES (?, ?, ?, ?)').run(chat.id, projectId, chat.title, chat.updatedAt);
      return chat;
    },
    get(id: string): ChatSnapshot | null {
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined;
        if (!row) return null;
        const messages = (db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY sequence').all(id) as MessageRow[]).map((m): MessageRecord => ({ id: m.id, chatId: m.chat_id, role: m.role, content: m.content, sourceSequence: m.role === 'user' ? m.sequence : null, createdAt: m.created_at, runId: m.run_id }));
        return { chat: record(row), messages, runs: createRunStore(db).list(id) };
      })();
    },
    delete(id: string): void {
      db.transaction(() => {
        db.prepare('DELETE FROM chats WHERE id = ?').run(id);
        reconcileMemory(db);
      }).immediate();
    },
  };
}
export type ChatStore = ReturnType<typeof createChatStore>;
