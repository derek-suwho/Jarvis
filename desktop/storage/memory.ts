import { randomUUID } from 'node:crypto';
import type { MemoryScope, ModelRef } from '../../src/shared/contracts';
import type {
  ExtractionInput,
  MemoryRecord,
  MemoryUpdate,
  RetrievalQuery,
  RunRecord,
  MessageRecord,
} from '../../src/shared/domain';
import type { Database } from './database';
import { createChatStore } from './chats';
import { createRunStore } from './runs';
import {
  identityKey,
  normalize,
  scopeKey,
  validateUpdate,
} from '../memory/validate';

export type MemoryJob = {
  id: string;
  runId: string;
  chatId: string;
  userMessageId: string;
  model: ModelRef;
  afterSequence: number;
  throughSequence: number;
  epoch: number;
  state: 'pending' | 'running' | 'failed' | 'complete';
  error: string | null;
  attempts: number;
};
export type MemorySummary = {
  chatId: string;
  text: string;
  throughSequence: number;
};
export type PendingEvidence = {
  message: MessageRecord;
  projectId: string | null;
  jobId: string;
};
type Row = {
  id: string;
  identity: string;
  scope_key: string;
  project_id: string | null;
  subject: string;
  key: string;
  value: string;
  keywords_json: string;
  status: MemoryRecord['status'];
  revision: number;
  manually_edited: number;
  source_sequence: number;
  kind: MemoryRecord['kind'];
  created_at: string;
  updated_at: string;
};
type Source = {
  message_id: string;
  quote: string;
  kind: MemoryRecord['kind'];
  sequence: number;
};
type JobRow = {
  id: string;
  run_id: string;
  chat_id: string;
  user_message_id: string;
  model_json: string;
  after_sequence: number;
  through_sequence: number;
  epoch: number;
  state: MemoryJob['state'];
  error: string | null;
  attempts: number;
};
const jobRecord = (r: JobRow): MemoryJob => ({
  id: r.id,
  runId: r.run_id,
  chatId: r.chat_id,
  userMessageId: r.user_message_id,
  model: JSON.parse(r.model_json),
  afterSequence: r.after_sequence,
  throughSequence: r.through_sequence,
  epoch: r.epoch,
  state: r.state,
  error: r.error,
  attempts: r.attempts,
});

/** Called within deletion transactions; surviving sources determine state again. */
export function reconcileMemory(db: Database, identity?: string): void {
  const rows = db
    .prepare(
      'SELECT * FROM memory_records' + (identity ? ' WHERE identity=?' : ''),
    )
    .all(...(identity ? [identity] : [])) as Row[];
  for (const key of new Set(rows.map((r) => r.identity))) {
    const group = rows.filter((r) => r.identity === key);
    const sources = db
      .prepare(
        'SELECT s.* FROM memory_sources s JOIN memory_records m ON m.id=s.memory_id WHERE m.identity=?',
      )
      .all(key) as Source[];
    const correction = Math.max(
      0,
      ...sources.filter((s) => s.kind === 'correction').map((s) => s.sequence),
    );
    const forgotten = (
      db
        .prepare('SELECT forgotten FROM memory_controls WHERE identity=?')
        .get(key) as { forgotten: number } | undefined
    )?.forgotten;
    const manual = group.find((r) => r.manually_edited);
    const eligible = group.filter(
      (r) =>
        !!db
          .prepare(
            'SELECT 1 FROM memory_sources WHERE memory_id=? AND sequence>=?',
          )
          .get(r.id, correction),
    );
    for (const row of group) {
      let status: MemoryRecord['status'] = 'active';
      if (forgotten) status = 'deleted';
      else if (manual) status = row.id === manual.id ? 'active' : 'superseded';
      else if (!eligible.includes(row)) status = 'superseded';
      else if (eligible.length > 1) status = 'conflicted';
      const seq = (
        db
          .prepare(
            'SELECT max(sequence) AS seq FROM memory_sources WHERE memory_id=?',
          )
          .get(row.id) as { seq: number | null }
      ).seq;
      if (seq === null) {
        db.prepare('DELETE FROM memory_records WHERE id=?').run(row.id);
        continue;
      }
      if (row.status !== status || row.source_sequence !== seq)
        db.prepare(
          'UPDATE memory_records SET status=?,source_sequence=?,revision=revision+1,updated_at=? WHERE id=?',
        ).run(status, seq, new Date().toISOString(), row.id);
    }
  }
}
export function createMemoryStore(db: Database) {
  function record(row: Row): MemoryRecord {
    const sources = db
      .prepare(
        'SELECT * FROM memory_sources WHERE memory_id=? ORDER BY sequence',
      )
      .all(row.id) as Source[];
    return {
      id: row.id,
      scope:
        row.scope_key === 'global'
          ? { kind: 'global' }
          : { kind: 'project', projectId: row.project_id },
      subject: row.subject,
      key: row.key,
      value: row.value,
      keywords: JSON.parse(row.keywords_json),
      status: row.status,
      revision: row.revision,
      manuallyEdited: !!row.manually_edited,
      sourceSequence: row.source_sequence,
      kind: row.kind,
      sourceMessageIds: sources.map((s) => s.message_id),
      evidence: sources.map((s) => ({
        messageId: s.message_id,
        quote: s.quote,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  const rowById = (id: string) =>
    db.prepare('SELECT * FROM memory_records WHERE id=?').get(id) as
      Row | undefined;
  const getJob = (id: string): MemoryJob | null => {
    const row = db.prepare('SELECT * FROM memory_jobs WHERE id=?').get(id) as
      JobRow | undefined;
    return row ? jobRecord(row) : null;
  };
  const jobs = (): MemoryJob[] =>
    (
      db
        .prepare('SELECT * FROM memory_jobs ORDER BY through_sequence,id')
        .all() as JobRow[]
    ).map(jobRecord);
  const list = (scope?: MemoryScope): MemoryRecord[] =>
    (
      db
        .prepare(
          'SELECT * FROM memory_records' +
            (scope ? ' WHERE scope_key=?' : '') +
            ' ORDER BY source_sequence DESC,id',
        )
        .all(...(scope ? [scopeKey(scope)] : [])) as Row[]
    ).map(record);
  const getSummary = (chatId: string): MemorySummary | null => {
    const r = db
      .prepare('SELECT * FROM memory_summaries WHERE chat_id=?')
      .get(chatId) as
      { chat_id: string; text: string; through_sequence: number } | undefined;
    return r
      ? { chatId: r.chat_id, text: r.text, throughSequence: r.through_sequence }
      : null;
  };
  function extractionInput(jobId: string): ExtractionInput | null {
    const job = getJob(jobId);
    if (!job) return null;
    const snapshot = createChatStore(db).get(job.chatId);
    if (!snapshot) return null;
    // Includes earlier complete assistant proposals for explicit adoption, never failed attempts.
    snapshot.messages = snapshot.messages.filter((m) =>
      m.role === 'user'
        ? m.sourceSequence! <= job.throughSequence
        : snapshot.runs.some(
            (r) =>
              r.assistantMessageId === m.id &&
              r.state === 'complete' &&
              snapshot.messages.some(
                (u) =>
                  u.id === r.userMessageId &&
                  u.sourceSequence! <= job.throughSequence,
              ),
          ),
    );
    const summary = getSummary(job.chatId);
    return {
      snapshot,
      previousSummary:
        summary && summary.throughSequence <= job.afterSequence
          ? summary.text
          : null,
      afterSequence: job.afterSequence,
      throughSequence: job.throughSequence,
      knownFacts: knownFacts(snapshot.chat.projectId),
    };
  }
  function knownFacts(projectId: string | null): ExtractionInput['knownFacts'] {
    const saved = list().map(({ id, scope, subject, key, value, status }) => ({
      id,
      scope,
      subject,
      key,
      value,
      status,
    }));
    const orphaned = db
      .prepare(
        'SELECT identity FROM memory_controls c WHERE forgotten=1 AND NOT EXISTS(SELECT 1 FROM memory_records m WHERE m.identity=c.identity)',
      )
      .all() as { identity: string }[];
    for (const { identity } of orphaned) {
      const [scope, subject, key] = JSON.parse(identity) as [
        string,
        string,
        string,
      ];
      saved.unshift({
        id: `tombstone:${identity}`,
        scope:
          scope === 'global'
            ? { kind: 'global' }
            : {
                kind: 'project',
                projectId:
                  scope === 'project:general'
                    ? null
                    : scope.slice('project:id:'.length),
              },
        subject,
        key,
        value: '',
        status: 'deleted',
      });
    }
    return saved
      .filter(
        (f) => f.scope.kind === 'global' || f.scope.projectId === projectId,
      )
      .slice(0, 128);
  }
  function epoch(identity: string, forgotten?: number) {
    db.prepare('UPDATE memory_clock SET epoch=epoch+1 WHERE id=1').run();
    const n = (
      db.prepare('SELECT epoch FROM memory_clock WHERE id=1').get() as {
        epoch: number;
      }
    ).epoch;
    db.prepare(
      'INSERT INTO memory_controls(identity,epoch,forgotten) VALUES (?,?,?) ON CONFLICT(identity) DO UPDATE SET epoch=excluded.epoch,forgotten=excluded.forgotten',
    ).run(identity, n, forgotten ?? 0);
  }
  return {
    list,
    get(id: string): MemoryRecord | null {
      const r = rowById(id);
      return r ? record(r) : null;
    },
    jobs,
    getJob,
    getSummary,
    extractionInput,
    enqueue(run: RunRecord): MemoryJob | null {
      return db
        .transaction(() => {
          const saved = createRunStore(db).get(run.id);
          if (!saved || saved.state !== 'complete') return null;
          const existing = db
            .prepare('SELECT * FROM memory_jobs WHERE user_message_id=?')
            .get(saved.userMessageId) as JobRow | undefined;
          if (existing) return jobRecord(existing);
          const through = (
            db
              .prepare(
                "SELECT sequence FROM messages WHERE id=? AND role='user'",
              )
              .get(saved.userMessageId) as { sequence: number }
          ).sequence;
          const after = (
            db
              .prepare(
                'SELECT coalesce(max(through_sequence),0) AS seq FROM memory_jobs WHERE chat_id=? AND through_sequence<?',
              )
              .get(saved.chatId, through) as { seq: number }
          ).seq;
          const clock = (
            db.prepare('SELECT epoch FROM memory_clock WHERE id=1').get() as {
              epoch: number;
            }
          ).epoch;
          const id = randomUUID();
          db.prepare(
            "INSERT INTO memory_jobs(id,run_id,chat_id,user_message_id,model_json,after_sequence,through_sequence,epoch,state) VALUES (?,?,?,?,?,?,?,?,'pending')",
          ).run(
            id,
            saved.id,
            saved.chatId,
            saved.userMessageId,
            JSON.stringify(saved.model),
            after,
            through,
            clock,
          );
          return getJob(id);
        })
        .immediate();
    },
    apply(jobId: string, raw: MemoryUpdate): void {
      db.transaction(() => {
        const job = getJob(jobId);
        if (!job || job.state === 'complete') return;
        const input = extractionInput(jobId);
        if (!input) return;
        const update = validateUpdate(raw, input); // Validate whole batch before mutating.
        for (const fact of update.facts) {
          const identity = identityKey(fact),
            control = db
              .prepare('SELECT * FROM memory_controls WHERE identity=?')
              .get(identity) as
              { epoch: number; forgotten: number } | undefined;
          if (control && (control.forgotten || control.epoch > job.epoch))
            continue;
          const group = db
              .prepare('SELECT * FROM memory_records WHERE identity=?')
              .all(identity) as Row[],
            manual = group.find((r) => r.manually_edited);
          if (manual && normalize(manual.value) !== normalize(fact.value)) {
            if (fact.kind === 'correction')
              for (const messageId of fact.sourceMessageIds)
                db.prepare(
                  'INSERT OR IGNORE INTO memory_reviews(id,memory_id,message_id,candidate_json) VALUES (?,?,?,?)',
                ).run(randomUUID(), manual.id, messageId, JSON.stringify(fact));
            continue;
          }
          const existing = group.find(
              (r) => normalize(r.value) === normalize(fact.value),
            ),
            id = existing?.id ?? randomUUID(),
            now = new Date().toISOString();
          const seq = Math.max(
            ...fact.sourceMessageIds.map(
              (id) =>
                input.snapshot.messages.find((m) => m.id === id)!
                  .sourceSequence!,
            ),
          );
          if (!existing)
            db.prepare(
              "INSERT INTO memory_records(id,identity,scope_key,project_id,subject,key,value,keywords_json,status,revision,source_sequence,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,?,?)",
            ).run(
              id,
              identity,
              scopeKey(fact.scope),
              fact.scope.kind === 'project' ? fact.scope.projectId : null,
              fact.subject,
              fact.key,
              fact.value,
              JSON.stringify(fact.keywords),
              seq,
              fact.kind,
              now,
              now,
            );
          else
            db.prepare(
              'UPDATE memory_records SET keywords_json=?,revision=revision+1,updated_at=? WHERE id=?',
            ).run(
              JSON.stringify(
                [
                  ...new Set([
                    ...(JSON.parse(existing.keywords_json) as string[]),
                    ...fact.keywords,
                  ]),
                ].slice(0, 16),
              ),
              now,
              id,
            );
          for (const e of fact.evidence) {
            const sequence = input.snapshot.messages.find(
              (m) => m.id === e.messageId,
            )!.sourceSequence!;
            db.prepare(
              "INSERT INTO memory_sources(memory_id,message_id,quote,kind,sequence) VALUES (?,?,?,?,?) ON CONFLICT(memory_id,message_id) DO UPDATE SET kind=CASE WHEN excluded.kind='correction' THEN excluded.kind ELSE memory_sources.kind END",
            ).run(id, e.messageId, e.quote, fact.kind, sequence);
          }
          reconcileMemory(db, identity);
        }
        db.prepare(
          'INSERT INTO memory_summaries(chat_id,text,through_sequence) VALUES (?,?,?) ON CONFLICT(chat_id) DO UPDATE SET text=excluded.text,through_sequence=excluded.through_sequence WHERE excluded.through_sequence>memory_summaries.through_sequence',
        ).run(job.chatId, update.summary, job.throughSequence);
        db.prepare(
          "UPDATE memory_jobs SET state='complete',error=NULL WHERE id=?",
        ).run(jobId);
      }).immediate();
    },
    edit(id: string, value: string, expectedRevision: number): MemoryRecord {
      return db
        .transaction(() => {
          const row = rowById(id);
          if (!row) throw new Error('Memory not found');
          if (row.revision !== expectedRevision)
            throw new Error('Memory revision conflict');
          if (
            typeof value !== 'string' ||
            !value.trim() ||
            Buffer.byteLength(value) > 2048
          )
            throw new Error('Invalid memory value');
          if (row.status === 'deleted')
            throw new Error('Restore memory before editing');
          // Merge only equal-value sources; different competing values remain separate.
          const matches = (
            db
              .prepare(
                'SELECT * FROM memory_records WHERE identity=? AND id<>?',
              )
              .all(row.identity, id) as Row[]
          ).filter((r) => normalize(r.value) === normalize(value));
          for (const match of matches) {
            db.prepare(
              'INSERT OR IGNORE INTO memory_sources(memory_id,message_id,quote,kind,sequence) SELECT ?,message_id,quote,kind,sequence FROM memory_sources WHERE memory_id=?',
            ).run(id, match.id);
            db.prepare('DELETE FROM memory_records WHERE id=?').run(match.id);
          }
          db.prepare(
            'UPDATE memory_records SET manually_edited=0 WHERE identity=?',
          ).run(row.identity);
          db.prepare(
            'UPDATE memory_records SET value=?,manually_edited=1,revision=revision+1,updated_at=? WHERE id=?',
          ).run(value.trim(), new Date().toISOString(), id);
          epoch(row.identity);
          reconcileMemory(db, row.identity);
          return record(rowById(id)!);
        })
        .immediate();
    },
    forget(id: string): void {
      db.transaction(() => {
        const row = rowById(id);
        if (!row) return;
        epoch(row.identity, 1);
        reconcileMemory(db, row.identity);
      }).immediate();
    },
    restore(id: string): void {
      db.transaction(() => {
        const row = rowById(id);
        if (!row) return;
        epoch(row.identity, 0);
        reconcileMemory(db, row.identity);
      }).immediate();
    },
    listReviews(): {
      id: string;
      memoryId: string;
      messageId: string;
      candidate: MemoryUpdate['facts'][number];
    }[] {
      return (
        db.prepare('SELECT * FROM memory_reviews ORDER BY rowid').all() as {
          id: string;
          memory_id: string;
          message_id: string;
          candidate_json: string;
        }[]
      ).map((r) => ({
        id: r.id,
        memoryId: r.memory_id,
        messageId: r.message_id,
        candidate: JSON.parse(r.candidate_json),
      }));
    },
    searchIndex(text: string): MemoryRecord[] {
      const tokens = text.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 24) ?? [];
      if (!tokens.length) return [];
      const query = tokens.map((t) => '"' + t + '"').join(' OR ');
      return (
        db
          .prepare(
            'SELECT m.* FROM memory_fts f JOIN memory_records m ON m.id=f.id WHERE memory_fts MATCH ? ORDER BY rank LIMIT 100',
          )
          .all(query) as Row[]
      ).map(record);
    },
    rebuildIndex(): void {
      db.transaction(() => {
        db.prepare('DELETE FROM memory_fts').run();
        db.prepare(
          "INSERT INTO memory_fts(id,subject,key,value,keywords) SELECT id,subject,key,value,keywords_json FROM memory_records WHERE status='active'",
        ).run();
      }).immediate();
    },
    pendingEvidence(query: RetrievalQuery): PendingEvidence[] {
      const terms =
        query.text.toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [];
      const projectRows = db
        .prepare('SELECT id,name,aliases_json FROM projects')
        .all() as { id: string; name: string; aliases_json: string }[];
      const named = new Set(
        projectRows
          .filter((p) =>
            [p.name, ...(JSON.parse(p.aliases_json) as string[])].some((n) =>
              query.text.toLocaleLowerCase().includes(n.toLocaleLowerCase()),
            ),
          )
          .map((p) => p.id),
      );
      const result: PendingEvidence[] = [];
      for (const job of jobs().filter((j) => j.state !== 'complete')) {
        const snapshot = createChatStore(db).get(job.chatId);
        if (!snapshot) continue;
        for (const message of snapshot.messages.filter(
          (m) =>
            m.role === 'user' &&
            m.sourceSequence! > job.afterSequence &&
            m.sourceSequence! <= job.throughSequence,
        )) {
          const relevant =
            job.chatId === query.chatId ||
            snapshot.chat.projectId === query.projectId ||
            named.has(snapshot.chat.projectId!) ||
            terms.some((t) =>
              message.content.toLocaleLowerCase().includes(t),
            ) ||
            /\b(?:i prefer|my preference|always|never|all projects|globally)\b/i.test(
              message.content,
            );
          if (relevant && !result.some((r) => r.message.id === message.id))
            result.push({
              message,
              projectId: snapshot.chat.projectId,
              jobId: job.id,
            });
        }
      }
      return result.sort(
        (a, b) => b.message.sourceSequence! - a.message.sourceSequence!,
      );
    },
    retryForContext(query: RetrievalQuery): number {
      return db
        .transaction(() => {
          const evidence = createMemoryStore(db).pendingEvidence(query);
          const chatIds = new Set(evidence.map((item) => item.message.chatId));
          let retried = 0;
          for (const chatId of chatIds) {
            retried += db
              .prepare(
                "UPDATE memory_jobs SET state='pending',error=NULL WHERE chat_id=? AND state='failed'",
              )
              .run(chatId).changes;
          }
          return retried;
        })
        .immediate();
    },
    claimNext(excludedChatIds: readonly string[] = []): MemoryJob | null {
      return db
        .transaction(() => {
          const row = db
            .prepare(
              "SELECT j.* FROM memory_jobs j WHERE j.state='pending'" +
                (excludedChatIds.length
                  ? ` AND j.chat_id NOT IN (${excludedChatIds.map(() => '?').join(',')})`
                  : '') +
                " AND NOT EXISTS(SELECT 1 FROM memory_jobs earlier WHERE earlier.chat_id=j.chat_id AND earlier.through_sequence<j.through_sequence AND earlier.state<>'complete') ORDER BY j.through_sequence LIMIT 1",
            )
            .get(...excludedChatIds) as JobRow | undefined;
          if (!row) return null;
          db.prepare(
            "UPDATE memory_jobs SET state='running',attempts=attempts+1,error=NULL WHERE id=?",
          ).run(row.id);
          return getJob(row.id);
        })
        .immediate();
    },
    failJob(id: string, error: string): void {
      db.prepare(
        "UPDATE memory_jobs SET state='failed',error=? WHERE id=? AND state<>'complete'",
      ).run(error.slice(0, 1024), id);
    },
    resumeJobs(): void {
      db.transaction(() => {
        db.prepare(
          "UPDATE memory_jobs SET state='pending',error=NULL WHERE state IN ('running','failed')",
        ).run();
        // Recovery closes the completion/enqueue crash window, in global evidence order.
        const missing = db
          .prepare(
            "SELECT r.id FROM runs r JOIN messages m ON m.id=r.user_message_id WHERE r.state='complete' AND NOT EXISTS(SELECT 1 FROM memory_jobs j WHERE j.user_message_id=r.user_message_id) ORDER BY m.sequence",
          )
          .all() as { id: string }[];
        const store = createMemoryStore(db);
        for (const { id } of missing)
          store.enqueue(createRunStore(db).get(id)!);
      }).immediate();
    },
  };
}
export type MemoryStore = ReturnType<typeof createMemoryStore>;
