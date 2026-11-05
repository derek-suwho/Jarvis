import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../../desktop/storage/database';
import { createCheckpointStore } from '../../desktop/storage/checkpoints';
import type { Chat } from '../../src/shared/chatTypes';

it('keeps three 10 MiB attachments outside checkpoint metadata, restores them, and prunes deleted bytes atomically', () => {
  const dir = mkdtempSync(join(process.cwd(), '.checkpoint-media-'));
  const path = join(dir, 'chat.db');
  let db = openDatabase(path);
  try {
    const data = Buffer.alloc(10 * 1024 * 1024, 97).toString('base64');
    const archive: Chat[] = [{ id: 'chat', title: 'Media history', updatedAt: 1,
      messages: Array.from({ length: 3 }, (_, i) => ({ id: `message-${i}`, role: 'user' as const, content: 'Inspect',
        attachments: [{ id: `file-${i}`, name: 'file.pdf', type: 'application/pdf', size: 10 * 1024 * 1024, data }],
      })) }];
    createCheckpointStore(db).save(archive);
    const row = db.prepare('SELECT chats_json FROM renderer_checkpoint').get() as { chats_json: string };
    expect(Buffer.byteLength(row.chats_json)).toBeLessThan(4096);
    db.close();
    db = openDatabase(path);
    expect(createCheckpointStore(db).load()).toEqual(archive);
    expect(db.prepare('SELECT count(*) AS n FROM renderer_checkpoint_media').get()).toEqual({ n: 3 });

    // A title-only save must not rewrite identical large media rows.
    db.exec(`CREATE TRIGGER reject_media_insert BEFORE INSERT ON renderer_checkpoint_media
      BEGIN SELECT RAISE(ABORT, 'unchanged media inserted'); END`);
    db.exec(`CREATE TRIGGER reject_media_rewrite BEFORE UPDATE ON renderer_checkpoint_media
      BEGIN SELECT RAISE(ABORT, 'media rewritten'); END`);
    archive[0].title = 'Renamed';
    createCheckpointStore(db).save(archive);
    expect(createCheckpointStore(db).load()).toEqual(archive);

    // A metadata write failure must roll back media pruning as well.
    db.exec(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON renderer_checkpoint
      BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
    expect(() => createCheckpointStore(db).save([])).toThrow('disk failure');
    expect(createCheckpointStore(db).load()).toEqual(archive);
    db.exec('DROP TRIGGER reject_checkpoint');
    createCheckpointStore(db).save([]);
    expect(createCheckpointStore(db).load()).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM renderer_checkpoint_media').get()).toEqual({ n: 0 });
  } finally { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('loads legacy inline media and separates it on save, failing explicitly if a referenced row is lost', () => {
  const db = openDatabase(':memory:');
  try {
    const archive: Chat[] = [{ id: 'legacy', title: 'Old archive', updatedAt: 1, messages: [
      { id: 'u', role: 'user', content: 'Inspect', attachments: [
        { id: 'image', name: 'image.png', type: 'image/png', size: 1, preview: 'data:image/png;base64,YQ==' },
        { id: 'text', name: 'note.txt', type: 'text/plain', size: 7, text: 'private' },
      ] },
    ] }];
    db.prepare('INSERT INTO renderer_checkpoint(id, chats_json) VALUES (1, ?)').run(JSON.stringify(archive));
    const store = createCheckpointStore(db);
    expect(store.load()).toEqual(archive);
    store.save(store.load()!);
    expect(store.load()).toEqual(archive);
    db.prepare('DELETE FROM renderer_checkpoint_media').run();
    expect(() => store.load()).toThrow('Stored checkpoint archive is invalid.');
  } finally { db.close(); }
});

it('retains unchanged media rows when earlier chats are inserted, reordered, or deleted', () => {
  const db = openDatabase(':memory:');
  try {
    const store = createCheckpointStore(db);
    const makeChat = (id: string): Chat => ({ id, title: id, updatedAt: 1, messages: [
      { id: 'user', role: 'user', content: 'Inspect', attachments: [
        { id: 'file', name: 'file.txt', type: 'text/plain', size: 1, text: id },
      ] },
    ] });
    const first = makeChat('first');
    const second = makeChat('second');
    store.save([first, second]);
    const keys = db.prepare('SELECT media_key FROM renderer_checkpoint_media ORDER BY media_key').all();
    db.exec(`CREATE TRIGGER reject_media_update BEFORE UPDATE ON renderer_checkpoint_media
      BEGIN SELECT RAISE(ABORT, 'unchanged media rewritten'); END`);
    const empty: Chat = { id: 'new', title: 'New', updatedAt: 2, messages: [] };
    store.save([empty, second, first]);
    expect(store.load()).toEqual([empty, second, first]);
    expect(db.prepare('SELECT media_key FROM renderer_checkpoint_media ORDER BY media_key').all()).toEqual(keys);
    store.save([second]);
    expect(store.load()).toEqual([second]);
    expect(db.prepare('SELECT count(*) AS n FROM renderer_checkpoint_media').get()).toEqual({ n: 1 });
  } finally { db.close(); }
});
