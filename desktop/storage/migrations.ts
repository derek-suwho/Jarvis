import type { Database } from './database';
import { memoryMigration } from './memory-migration';
export type Migration = { version: number; up(db: Database): void };

const migrations: Migration[] = [{ version: 1, up(db) {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX chats_project ON chats(project_id);
    CREATE TABLE messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX messages_chat ON messages(chat_id, sequence);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      assistant_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL CHECK(provider_id IN ('chatgpt', 'claude', 'grok', 'gemini')),
      model_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued', 'streaming', 'complete', 'cancelled', 'failed', 'interrupted')),
      error TEXT,
      input_json TEXT NOT NULL,
      request_key TEXT NOT NULL,
      retry_of TEXT REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX one_active_run_per_chat ON runs(chat_id) WHERE state IN ('queued', 'streaming');
    CREATE INDEX runs_chat ON runs(chat_id);
    CREATE TABLE legacy_imports (
      legacy_id TEXT PRIMARY KEY,
      source_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
} }, memoryMigration];

/** Each migration and its ledger write commit together; failed versions remain retryable. */
export function migrate(db: Database, versions: readonly Migration[] = migrations): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const record = db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)');
    for (const migration of [...versions].sort((a, b) => a.version - b.version)) {
      if (applied.get(migration.version)) continue;
      migration.up(db);
      record.run(migration.version, new Date().toISOString());
    }
  }).immediate();
}
