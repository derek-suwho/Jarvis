import type { ImportResult, Role } from '../../src/shared/contracts';
import type { Database } from './database';

type LegacyMessage = { id: string; role: Role; content: string; model?: string };
type LegacyChat = { id: string; title: string; messages: LegacyMessage[]; updatedAt: number };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function valid(value: unknown): value is LegacyChat {
  if (!object(value) || !id(value.id) || typeof value.title !== 'string' || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || !Number.isFinite(new Date(value.updatedAt).getTime()) || !Array.isArray(value.messages)) return false;
  const ids = new Set<string>();
  return value.messages.every((m: unknown) => {
    if (!object(m) || !id(m.id) || ids.has(m.id) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || (m.model !== undefined && typeof m.model !== 'string')) return false;
    ids.add(m.id); return true;
  });
}

/** Per-chat transactions allow valid neighbors through without partial corrupt transcripts. */
export function importLegacyChats(db: Database, json: string): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, rejected: 0 };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ...result, rejected: 1 }; }
  if (!Array.isArray(parsed)) return { ...result, rejected: 1 };
  const insert = db.transaction((chat: LegacyChat) => {
    const source = JSON.stringify(chat);
    const previous = db.prepare('SELECT source_json FROM legacy_imports WHERE legacy_id = ?').get(chat.id) as { source_json: string } | undefined;
    if (previous) {
      if (previous.source_json !== source) throw new Error('Legacy source changed');
      return 'skipped' as const;
    }
    const timestamp = new Date(chat.updatedAt).toISOString();
    db.prepare('INSERT INTO chats(id, project_id, title, updated_at) VALUES (?, NULL, ?, ?)').run(chat.id, chat.title, timestamp);
    const message = db.prepare('INSERT INTO messages(id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const m of chat.messages) message.run(m.id, chat.id, m.role, m.content, timestamp);
    db.prepare('INSERT INTO legacy_imports(legacy_id, source_json, imported_at) VALUES (?, ?, ?)').run(chat.id, source, new Date().toISOString());
    return 'imported' as const;
  });
  for (const item of parsed) {
    if (!valid(item)) { result.rejected++; continue; }
    try { result[insert.immediate(item)]++; } catch (error) {
      // Constraint collisions reject this chat; unexpected database failures remain visible.
      if (error instanceof Error && (error.message === 'Legacy source changed' || ('code' in error && String(error.code).startsWith('SQLITE_CONSTRAINT')))) result.rejected++;
      else throw error;
    }
  }
  return result;
}
