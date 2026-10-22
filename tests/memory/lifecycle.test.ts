import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../desktop/storage/database';
import { createChatStore } from '../../desktop/storage/chats';
import { createProjectStore } from '../../desktop/storage/projects';
import { createRunStore } from '../../desktop/storage/runs';
import { createMemoryStore } from '../../desktop/storage/memory';
import type { CandidateFact } from '../../src/shared/domain';

describe('memory lifecycle', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => db.close());
  const model = { providerId: 'chatgpt' as const, modelId: 'origin' };
  function turn(
    text: string,
    projectId: string | null = null,
    chatId?: string,
  ) {
    const chats = createChatStore(db),
      runs = createRunStore(db),
      memory = createMemoryStore(db);
    const chat = chatId ? chats.get(chatId)!.chat : chats.create(projectId);
    const run = runs.begin({
      requestId: crypto.randomUUID(),
      chatId: chat.id,
      text,
      model,
    });
    runs.finish(run.id, 'complete');
    const job = memory.enqueue(runs.get(run.id)!);
    return { chat, run, job, memory };
  }
  function fact(
    t: ReturnType<typeof turn>,
    value: string,
    kind: 'assertion' | 'correction' = 'assertion',
  ): CandidateFact {
    return {
      scope: { kind: 'global' },
      subject: 'User',
      key: 'database',
      value,
      keywords: ['database'],
      sourceMessageIds: [t.run.userMessageId],
      evidence: [
        {
          messageId: t.run.userMessageId,
          quote: createChatStore(db)
            .get(t.chat.id)!
            .messages.find((m) => m.id === t.run.userMessageId)!.content,
        },
      ],
      kind,
    };
  }
  function apply(
    t: ReturnType<typeof turn>,
    value: string,
    kind: 'assertion' | 'correction' = 'assertion',
  ) {
    t.memory.apply(t.job!.id, {
      summary: 'Summary',
      facts: [fact(t, value, kind)],
    });
  }
  it('merges repeated General keys and indexes only active records', () => {
    const a = turn('Use SQLite'),
      b = turn('Use SQLite');
    for (const t of [a, b]) {
      const f = fact(t, 'SQLite');
      f.scope = { kind: 'project', projectId: null };
      t.memory.apply(t.job!.id, { summary: '', facts: [f] });
    }
    expect(a.memory.list()).toHaveLength(1);
    expect(a.memory.list()[0].sourceMessageIds).toHaveLength(2);
    expect(a.memory.searchIndex('SQLite').map((f) => f.id)).toEqual([
      a.memory.list()[0].id,
    ]);
  });
  it('orders corrections by source sequence regardless completion order', () => {
    const a = turn('Use SQLite'),
      b = turn('Actually change to Postgres'),
      c = turn('Actually change to MySQL');
    apply(c, 'MySQL', 'correction');
    apply(a, 'SQLite');
    apply(b, 'Postgres', 'correction');
    expect(
      a.memory
        .list()
        .filter((f) => f.status === 'active')
        .map((f) => f.value),
    ).toEqual(['MySQL']);
  });
  it('excludes unresolved contradictions until explicit correction', () => {
    const a = turn('Use SQLite'),
      b = turn('Use Postgres');
    apply(a, 'SQLite');
    apply(b, 'Postgres');
    expect(a.memory.list().every((f) => f.status === 'conflicted')).toBe(true);
    expect(a.memory.searchIndex('SQLite')).toEqual([]);
    const c = turn('Actually change to MySQL');
    apply(c, 'MySQL', 'correction');
    expect(
      c.memory
        .list()
        .filter((f) => f.status === 'active')
        .map((f) => f.value),
    ).toEqual(['MySQL']);
  });
  it('manual edit wins, stale results cannot change it, future correction becomes review', () => {
    const a = turn('Use SQLite');
    apply(a, 'SQLite');
    const stale = turn('Actually change to Postgres');
    const f = a.memory.list()[0];
    a.memory.edit(f.id, 'MariaDB', f.revision);
    expect(() => a.memory.edit(f.id, 'bad', f.revision)).toThrow(/revision/i);
    apply(stale, 'Postgres', 'correction');
    const future = turn('Actually change to MySQL');
    apply(future, 'MySQL', 'correction');
    expect(
      a.memory
        .list()
        .filter((f) => f.status === 'active')
        .map((f) => f.value),
    ).toEqual(['MariaDB']);
    expect(a.memory.listReviews()).toHaveLength(1);
  });
  it('forget survives stale updates and restart; restore rejects pre-restore work', () => {
    const a = turn('Use SQLite');
    apply(a, 'SQLite');
    const stale = turn('Use SQLite');
    const id = a.memory.list()[0].id;
    a.memory.forget(id);
    apply(stale, 'SQLite');
    expect(createMemoryStore(db).searchIndex('SQLite')).toEqual([]);
    const during = turn('Use SQLite');
    a.memory.restore(id);
    apply(during, 'SQLite');
    expect(a.memory.list()[0].sourceMessageIds).toEqual([a.run.userMessageId]);
  });
  it('deletion preserves only genuinely surviving same-value sources', () => {
    const a = turn('Use SQLite'),
      b = turn('Use SQLite'),
      c = turn('Actually change to Postgres');
    apply(a, 'SQLite');
    apply(b, 'SQLite');
    apply(c, 'Postgres', 'correction');
    createChatStore(db).delete(c.chat.id);
    expect(
      a.memory
        .list()
        .filter((f) => f.status === 'active')
        .map((f) => f.value),
    ).toEqual(['SQLite']);
    createChatStore(db).delete(a.chat.id);
    expect(a.memory.list()[0].sourceMessageIds).toEqual([b.run.userMessageId]);
    createChatStore(db).delete(b.chat.id);
    expect(a.memory.list()).toEqual([]);
  });
  it('deletes pending jobs/summaries/project facts atomically and ignores late update', () => {
    const p = createProjectStore(db).create('Project', []),
      a = turn('Use SQLite', p.id);
    apply(a, 'SQLite');
    const pending = turn('Use Postgres', p.id, a.chat.id);
    const late = { summary: 'late', facts: [fact(pending, 'Postgres')] };
    createProjectStore(db).delete(p.id);
    pending.memory.apply(pending.job!.id, late);
    expect(a.memory.list()).toEqual([]);
    expect(a.memory.jobs()).toEqual([]);
    expect(a.memory.getSummary(a.chat.id)).toBeNull();
  });
  it('manual edit merging an existing value preserves its independent sources', () => {
    const a = turn('Use SQLite'),
      b = turn('Use Postgres');
    apply(a, 'SQLite');
    apply(b, 'Postgres');
    const original = a.memory.list().find((f) => f.value === 'SQLite')!;
    a.memory.edit(original.id, 'Postgres', original.revision);
    createChatStore(db).delete(a.chat.id);
    expect(a.memory.list()).toHaveLength(1);
    expect(a.memory.list()[0]).toMatchObject({
      value: 'Postgres',
      status: 'active',
      sourceMessageIds: [b.run.userMessageId],
    });
  });
  it('merges case/whitespace variants of the same value', () => {
    const a = turn('Use SQLite'),
      b = turn('Use SQLITE');
    apply(a, 'SQLite');
    apply(b, 'SQLITE');
    expect(a.memory.list()).toHaveLength(1);
    expect(a.memory.list()[0].sourceMessageIds).toHaveLength(2);
  });
  it('validates provenance and scope in store, rolls back invalid batches', () => {
    const a = turn('Use SQLite'),
      b = turn('Use Postgres'),
      p = createProjectStore(db).create('Wrong', []);
    const good = fact(a, 'SQLite');
    for (const bad of [
      { ...good, value: 'invented' },
      { ...good, sourceMessageIds: [b.run.userMessageId] },
      { ...good, scope: { kind: 'project' as const, projectId: p.id } },
      {
        ...good,
        evidence: [{ messageId: a.run.assistantMessageId, quote: 'SQLite' }],
      },
    ])
      expect(() =>
        a.memory.apply(a.job!.id, { summary: 'bad', facts: [good, bad] }),
      ).toThrow();
    expect(a.memory.list()).toEqual([]);
    expect(a.memory.getSummary(a.chat.id)).toBeNull();
  });
});
