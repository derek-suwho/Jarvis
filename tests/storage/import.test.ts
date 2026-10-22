import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { createChatStore } from '../../desktop/storage/chats';
import { importLegacyChats } from '../../desktop/storage/import';

describe('validated legacy import', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => { db = openDatabase(':memory:'); }); afterEach(() => db.close());
  const chat = { id: 'old-chat', title: 'Old title', updatedAt: 1700000000000, messages: [{ id: 'old-u', role: 'user', content: 'Original' }, { id: 'old-a', role: 'assistant', content: 'Answer', model: 'legacy-model' }] };

  it('preserves IDs, order, timestamps, raw source and idempotency after deletion', () => {
    const json = JSON.stringify([chat, { ...chat, id: 'empty', messages: [] }]);
    expect(importLegacyChats(db, json)).toEqual({ imported: 2, skipped: 0, rejected: 0 });
    expect(importLegacyChats(db, json)).toEqual({ imported: 0, skipped: 2, rejected: 0 });
    expect(createChatStore(db).get('old-chat')).toMatchObject({ chat: { id: 'old-chat', projectId: null, updatedAt: '2023-11-14T22:13:20.000Z' }, messages: [{ id: 'old-u', content: 'Original' }, { id: 'old-a', content: 'Answer' }] });
    expect(db.prepare('SELECT source_json FROM legacy_imports WHERE legacy_id = ?').get('old-chat')).toEqual({ source_json: JSON.stringify(chat) });
    createChatStore(db).delete('old-chat');
    expect(importLegacyChats(db, json)).toEqual({ imported: 0, skipped: 2, rejected: 0 });
    expect(json).toBe(JSON.stringify([chat, { ...chat, id: 'empty', messages: [] }]));
  });

  it('rejects malformed chat or message atomically while importing valid neighbors', () => {
    const invalid = [null, { ...chat, id: 'bad-time', updatedAt: 'now' }, { ...chat, id: 'bad-role', messages: [{ id: 'x', role: 'system', content: 'bad' }] }, { ...chat, id: 'partial', messages: [chat.messages[0], { id: 'invalid', role: 'user' }] }, { ...chat, id: 'dupes', messages: [chat.messages[0], chat.messages[0]] }];
    expect(importLegacyChats(db, JSON.stringify([...invalid, chat]))).toEqual({ imported: 1, skipped: 0, rejected: 5 });
    expect(createChatStore(db).list().map(c => c.id)).toEqual(['old-chat']);
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 2 });
  });

  it('rejects corrupted JSON, conflicting IDs and changed previously imported source', () => {
    expect(importLegacyChats(db, '{')).toEqual({ imported: 0, skipped: 0, rejected: 1 });
    expect(importLegacyChats(db, '{}')).toEqual({ imported: 0, skipped: 0, rejected: 1 });
    importLegacyChats(db, JSON.stringify([chat]));
    expect(importLegacyChats(db, JSON.stringify([{ ...chat, title: 'changed' }, { ...chat, id: 'collision' }]))).toEqual({ imported: 0, skipped: 0, rejected: 2 });
    expect(createChatStore(db).get('old-chat')?.chat.title).toBe('Old title');
  });
});
