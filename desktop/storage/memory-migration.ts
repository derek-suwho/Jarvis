import type { Migration } from './migrations';
export const memoryMigration: Migration = {
  version: 2,
  up(db) {
    db.exec(`
 CREATE TABLE memory_clock (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL);
 INSERT INTO memory_clock VALUES (1,0);
 CREATE TABLE memory_controls (identity TEXT PRIMARY KEY, epoch INTEGER NOT NULL, forgotten INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE memory_records (
  id TEXT PRIMARY KEY, identity TEXT NOT NULL, scope_key TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, keywords_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','superseded','conflicted','deleted')), revision INTEGER NOT NULL,
  manually_edited INTEGER NOT NULL DEFAULT 0, source_sequence INTEGER NOT NULL, kind TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(identity,value)
 );
 CREATE INDEX memory_identity ON memory_records(identity);
 CREATE TABLE memory_sources (
  memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  quote TEXT NOT NULL, kind TEXT NOT NULL, sequence INTEGER NOT NULL,
  PRIMARY KEY(memory_id,message_id)
 );
 CREATE TABLE memory_jobs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  model_json TEXT NOT NULL, after_sequence INTEGER NOT NULL, through_sequence INTEGER NOT NULL,
  epoch INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','running','failed','complete')),
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX memory_jobs_chat ON memory_jobs(chat_id,through_sequence);
 CREATE TABLE memory_summaries (chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, text TEXT NOT NULL, through_sequence INTEGER NOT NULL);
 CREATE TABLE memory_reviews (
  id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, candidate_json TEXT NOT NULL,
  UNIQUE(memory_id,message_id)
 );
 CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, subject, key, value, keywords);
 CREATE TRIGGER memory_insert AFTER INSERT ON memory_records WHEN NEW.status='active' BEGIN
  INSERT INTO memory_fts(id,subject,key,value,keywords) VALUES(NEW.id,NEW.subject,NEW.key,NEW.value,NEW.keywords_json);
 END;
 CREATE TRIGGER memory_update AFTER UPDATE ON memory_records BEGIN
  DELETE FROM memory_fts WHERE id=OLD.id;
  INSERT INTO memory_fts(id,subject,key,value,keywords) SELECT NEW.id,NEW.subject,NEW.key,NEW.value,NEW.keywords_json WHERE NEW.status='active';
 END;
 CREATE TRIGGER memory_delete AFTER DELETE ON memory_records BEGIN DELETE FROM memory_fts WHERE id=OLD.id; END;
 CREATE TRIGGER memory_source_delete AFTER DELETE ON memory_sources BEGIN
  DELETE FROM memory_records WHERE id=OLD.memory_id AND NOT EXISTS(SELECT 1 FROM memory_sources WHERE memory_id=OLD.memory_id);
 END;
 `);
  },
};
