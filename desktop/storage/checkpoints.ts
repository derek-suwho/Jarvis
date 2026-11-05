import { createHash } from 'node:crypto';
import type { Database } from './database';
import type { Attachment, Chat } from '../../src/shared/chatTypes';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every(key => value[key] === undefined || typeof value[key] === 'string');
const flags = (value: Record<string, unknown>, keys: string[]) =>
  keys.every(key => value[key] === undefined || typeof value[key] === 'boolean');
const optionalArray = (value: Record<string, unknown>, key: string, valid: (item: unknown) => boolean) =>
  value[key] === undefined || (Array.isArray(value[key]) && value[key].every(valid));
const oneOf = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value);
const attachment = (a: unknown) => record(a) && typeof a.id === 'string' && typeof a.name === 'string'
  && typeof a.type === 'string' && typeof a.size === 'number' && Number.isFinite(a.size) && a.size >= 0
  && strings(a, ['data', 'preview', 'text']);
const tool = (t: unknown) => record(t) && ['id', 'server', 'tool'].every(key => typeof t[key] === 'string')
  && strings(t, ['detail']) && oneOf(t.status, ['running', 'done', 'error']);
const message = (m: unknown) => record(m) && typeof m.id === 'string' && typeof m.content === 'string'
  && oneOf(m.role, ['user', 'assistant']) && strings(m, ['model', 'taskId', 'attemptId']) && flags(m, ['error'])
  && (m.taskRevision === undefined || (typeof m.taskRevision === 'number' && Number.isSafeInteger(m.taskRevision) && m.taskRevision >= 0))
  && (m.feedback === undefined || oneOf(m.feedback, ['up', 'down']))
  && (m.outcome === undefined || oneOf(m.outcome, ['complete', 'interrupted', 'cancelled', 'failed']))
  && (m.delivery === undefined || oneOf(m.delivery, ['queued', 'applying', 'applied', 'cancelled']))
  && optionalArray(m, 'attachments', attachment) && optionalArray(m, 'tools', tool);
const chat = (c: unknown) => record(c) && typeof c.id === 'string' && typeof c.title === 'string'
  && typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) && Array.isArray(c.messages) && c.messages.every(message)
  && strings(c, ['projectId', 'taskGeneration']) && flags(c, ['pinned', 'archived', 'temporary']);

/** Renderer archive bridge: preserves task metadata until normalized runtime integration.
 * This archive is not an extraction source for durable memory.
 */
export function createCheckpointStore(db: Database) {
  return {
    load(): Chat[] | null {
      const row = db.prepare('SELECT chats_json FROM renderer_checkpoint WHERE id = 1').get() as { chats_json: string } | undefined;
      if (!row) return null;
      try {
        const archive: unknown = JSON.parse(row.chats_json);
        if (!Array.isArray(archive) || !archive.every(chat)) throw new Error();
        const read = db.prepare('SELECT payload_json FROM renderer_checkpoint_media WHERE media_key = ?');
        for (const c of archive as Chat[]) for (const m of c.messages) for (const a of m.attachments ?? []) {
          const stored = a as Attachment & { _checkpointMedia?: unknown };
          if (stored._checkpointMedia === undefined) continue; // Legacy inline archive.
          if (typeof stored._checkpointMedia !== 'string') throw new Error();
          const row = read.get(stored._checkpointMedia) as { payload_json: string } | undefined;
          if (!row) throw new Error();
          const payload: unknown = JSON.parse(row.payload_json);
          if (!record(payload) || !strings(payload, ['data', 'preview', 'text'])
            || Object.keys(payload).some(key => !['data', 'preview', 'text'].includes(key))) throw new Error();
          delete stored._checkpointMedia;
          Object.assign(a, payload);
        }
        return archive as Chat[];
      } catch {
        // Parser diagnostics can contain excerpts of private chat content.
        // Keep corrupt data intact for recovery and fail the caller explicitly.
        throw new Error('Stored checkpoint archive is invalid.');
      }
    },
    save(chats: Chat[]): void {
      // Reject invalid updates before replacing the last recoverable archive.
      if (!Array.isArray(chats) || !chats.every(chat)) {
        throw new Error('Stored checkpoint archive is invalid.');
      }
      db.transaction(() => {
        const retained = new Set<string>();
        const existing = new Set((db.prepare('SELECT media_key FROM renderer_checkpoint_media').all() as { media_key: string }[])
          .map(row => row.media_key));
        const put = db.prepare(`INSERT INTO renderer_checkpoint_media(media_key, payload_json) VALUES (?, ?)
          ON CONFLICT(media_key) DO UPDATE SET payload_json = excluded.payload_json
          WHERE payload_json != excluded.payload_json`);
        const metadata = chats.filter(c => !c.temporary).map(c => ({ ...c,
          messages: c.messages.map(m => ({ ...m,
            ...(m.attachments ? { attachments: m.attachments.map(a => {
              const { data, preview, text, ...rest } = a;
              // Internal references are generated here, never trusted from callers.
              delete (rest as Record<string, unknown>)._checkpointMedia;
              if (data === undefined && preview === undefined && text === undefined) return rest;
              const payload = JSON.stringify({ data, preview, text });
              // Archive positions change on normal chat insertion/deletion.
              // Include payload content so duplicate IDs cannot alias distinct media.
              const key = createHash('sha256').update(JSON.stringify([c.id, m.id, a.id, payload])).digest('hex');
              retained.add(key);
              // Content-derived keys identify immutable payloads. Avoid binding and
              // inserting large bytes again on ordinary metadata-only saves.
              if (!existing.has(key)) {
                put.run(key, payload);
                existing.add(key);
              }
              return { ...rest, _checkpointMedia: key };
            }) } : {}),
          })),
        }));
        for (const key of existing) {
          if (!retained.has(key)) db.prepare('DELETE FROM renderer_checkpoint_media WHERE media_key = ?').run(key);
        }
        // Media and referencing metadata commit together, including intentional empty saves.
        db.prepare('INSERT INTO renderer_checkpoint(id, chats_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET chats_json = excluded.chats_json').run(JSON.stringify(metadata));
      })();
    },
  };
}
