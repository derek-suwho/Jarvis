import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { migrate, type Migration } from '../../desktop/storage/migrations';
import { createProjectStore } from '../../desktop/storage/projects';
import { createChatStore } from '../../desktop/storage/chats';
import { createRunStore } from '../../desktop/storage/runs';
import type { TurnInput } from '../../src/shared/contracts';

describe('durable chat storage', () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jarvis-')); db = openDatabase(join(dir, 'chat.db')); });
  afterEach(() => { vi.useRealTimers(); if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('persists projects, ordered chats, transcript and model attribution after reopen', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const projects = createProjectStore(db), chats = createChatStore(db), runs = createRunStore(db);
    const a = projects.create('Alpha', ['A']), b = projects.create('Beta', []);
    const first = chats.create(a.id), second = chats.create(b.id);
    vi.setSystemTime(new Date('2026-10-21T12:00:01Z'));
    const input: TurnInput = { requestId: 'send-1', chatId: first.id, text: 'Keep this', model: { providerId: 'claude', modelId: 'model-a' }, reasoning: 'high' };
    const run = runs.begin(input);
    runs.appendDelta(run.id, 'Saved'); runs.finish(run.id, 'complete');
    db.close(); db = openDatabase(join(dir, 'chat.db'));
    expect(createProjectStore(db).list()).toEqual([a, b]);
    expect(createChatStore(db).list(a.id).map(c => c.id)).toEqual([first.id]);
    expect(createChatStore(db).list().map(c => c.id)).toEqual([first.id, second.id]);
    expect(createChatStore(db).get(first.id)?.messages.map(m => [m.role, m.content])).toEqual([['user', 'Keep this'], ['assistant', 'Saved']]);
    expect(createRunStore(db).get(run.id)).toMatchObject({ state: 'complete', model: input.model });
    expect(createRunStore(db).getInput(run.id)).toEqual(input);
  });

  it('enforces foreign keys and rolls back invalid begin without orphan messages', () => {
    expect(() => createChatStore(db).create('missing')).toThrow();
    expect(() => createRunStore(db).begin({ requestId: 'bad', chatId: 'missing', text: 'Hi', model: { providerId: 'chatgpt', modelId: 'm' } })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rolls back user, assistant, and title when run insertion fails mid-transaction', () => {
    const chats = createChatStore(db), chat = chats.create(null);
    db.exec("CREATE TRIGGER reject_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'disk write failed'); END");
    expect(() => createRunStore(db).begin({ requestId: 'rollback', chatId: chat.id, text: 'Must not persist', model: { providerId: 'claude', modelId: 'm' } })).toThrow('disk write failed');
    expect(chats.get(chat.id)).toEqual({ chat, messages: [], runs: [] });
  });

  it('coordinates separate connections and recovers persisted unfinished runs only', () => {
    const chats = createChatStore(db), runs = createRunStore(db), chat = chats.create(null);
    const input: TurnInput = { requestId: 'complete', chatId: chat.id, text: 'First', model: { providerId: 'claude', modelId: 'm' } };
    const complete = runs.begin(input); runs.finish(complete.id, 'complete');
    const pending = runs.begin({ ...input, requestId: 'pending' }); runs.appendDelta(pending.id, 'Partial');
    const other = openDatabase(join(dir, 'chat.db'));
    try {
      expect(createRunStore(other).begin({ ...input, requestId: 'pending' }).id).toBe(pending.id);
      expect(() => createRunStore(other).begin({ ...input, requestId: 'blocked' })).toThrow(/active/i);
    } finally { other.close(); }
    db.close(); db = openDatabase(join(dir, 'chat.db'));
    expect(createRunStore(db).recoverInterrupted()).toBe(1);
    expect(createRunStore(db).get(complete.id)?.state).toBe('complete');
    expect(createRunStore(db).get(pending.id)?.state).toBe('interrupted');
    expect(createChatStore(db).get(chat.id)?.messages.at(-1)?.content).toBe('Partial');
  });

  it('rolls back a failed migration including its ledger and remains reopenable', () => {
    const before = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    const broken: Migration = { version: before.at(-1)!.version + 1, up(database) { database.exec('CREATE TABLE should_rollback(id TEXT)'); throw new Error('deliberate migration failure'); } };
    expect(() => migrate(db, [broken])).toThrow('deliberate migration failure');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'should_rollback'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual(before);
    db.close(); db = openDatabase(join(dir, 'chat.db'));
    expect(createProjectStore(db).create('Still works', []).name).toBe('Still works');
  });
});
