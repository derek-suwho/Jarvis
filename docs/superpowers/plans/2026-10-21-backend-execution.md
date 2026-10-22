# Jarvis Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps with checkboxes.

**Goal:** Execute the backend portion of the approved MVP plan without changing the frontend.

**Architecture:** Headless TypeScript service suitable for the Electron main process, SQLite stores, injected subscription adapters, automatic memory, and a narrow validated bridge. Default provider availability must reflect actual access-gate evidence; deterministic test adapters never ship as live providers.

**Tech Stack:** Existing TypeScript/Vitest, better-sqlite3/FTS5, existing Electron; no hosted backend or billing implementation in this slice.

**Spec:** [MVP design](../specs/2026-10-21-jarvis-mvp-design.md). Parent: [MVP implementation plan](2026-10-21-jarvis-shared-memory-mvp.md).

## Global Constraints

- Backend only. Do not edit existing frontend components/styles or replace their demo path in this slice.
- First pair: ChatGPT + Claude. Paid monthly app; each user supplies their own subscriptions.
- No separate paid API or hidden provider fallback; no production fake replies.
- Chats, memory, and credentials remain local. No content telemetry.
- Preserve all memory budgets, source ordering, correction, deletion, and cancellation rules in the spec.
- Never label fixture-based tests as live subscription evidence. Live adapters depend on an established supported route.

## Review Focus

1. Concurrent sends/retries and late deltas must not duplicate/cross chats: Tasks 1/4.
2. Database restart/import/deletion must preserve integrity: Tasks 1/2.
3. Delayed/stale memory updates must not undo corrections or deletion: Task 2.
4. Cross-project retrieval, Unicode budgets, pending evidence must obey relevance and limits: Task 3.
5. IPC and provider gates must reject malformed/unsupported access without fallback or secret exposure: Tasks 4/5.

---

### Task 1: Shared contracts and durable chat stores

**Files:** create `src/shared/{contracts,domain}.ts`, `desktop/providers/types.ts`, `desktop/storage/{database,migrations,projects,chats,runs,import}.ts`, `tsconfig.backend.json`; modify package scripts/dependencies; tests under `tests/storage/`.

**Interfaces:** use spec types; create `openDatabase(path)`, `migrate(db)`, `createProjectStore(db)` (`list/create/delete`), `createChatStore(db)` (`list/create/get/delete`), `createRunStore(db)` (`get/begin/appendDelta/finish/retry/recoverInterrupted`), `importLegacyChats(db,json)`. Record DTOs/signatures follow parent Task 1/2. Export inferred store types for later consumers. Add necessary read queries explicitly rather than making later tasks duplicate SQL.

- [ ] Test real temporary SQLite persistence/reopen, FK integrity, atomic migrations, idempotent send and import, conflict rejection for reused request IDs, one active run per chat, concurrency across chats, retry without duplicate user message, terminal-event protection, recovery, deletion, malformed import.
- [ ] Observe focused failures before implementation.
- [ ] Implement transactionally. Use monotonic database message sequence for user sources. Terminal runs are immutable; late events for deleted/cancelled runs do nothing. Preserve old localStorage payloads via validated import; no browser code changes.
- [ ] Add pinned required dependencies and `typecheck:backend`, `test:backend`; run focused tests, full tests, frontend build, backend typecheck.
- [ ] Commit `feat: add durable backend stores`; report red/green evidence and interfaces.

### Task 2: Durable memory lifecycle and extraction queue

**Files:** `desktop/storage/memory.ts`, memory migration, `desktop/memory/{extract,queue}.ts`, shared memory DTOs; tests under `tests/memory/`.

**Interfaces:** parent Task 4: `CandidateFact`, `MemoryRecord`, `MemoryUpdate`, `ExtractionInput`, `RetrievalQuery`; `extractMemory(input,adapter,model,signal)`, `createMemoryStore(db)` (`list/apply/edit/forget/restore`), `createMemoryQueue({db,memory,getAdapter})` (`enqueue/drainForContext/resume/stop`). Provide explicit store methods for durable jobs, summaries, pending evidence, retrieval index maintenance so later code need not guess SQL. `drainForContext` accepts the full query.

- [ ] Test grounded evidence validation, malformed/oversized extraction output, source/scope ownership, rejection of assistant-only facts, explicit adoption evidence, repeated fact merging, ordered correction, conflict exclusion, manual edit, forget/restore, stale result and source deletion.
- [ ] Observe focused failures; implement schema/migration, FTS index, transactional update rules, queued cutoff/revision snapshots, and per-chat extraction order.
- [ ] Extract through the originating injected adapter only; extra inference is never hidden fallback. Use bounded inputs and JSON validation; model text cannot authorize tools or memory commands. Failed updates remain retryable; no busy retry loop. Retain cancellation and the 10-second context-wait bound.
- [ ] Test queue restart and stop, same-provider model use, deletion during extraction, pending global evidence across projects, bounded generation/cancellation, and no resurrection of forgotten/deleted facts.
- [ ] Run focused/full tests and backend typecheck; commit `feat: maintain backend memory`.

### Task 3: Cross-project retrieval and context assembly

**Files:** `desktop/memory/retrieve.ts`, `desktop/chat/context.ts`, tests/fixtures/memory/scenarios.json, tests/memory/retrieval.test.ts, tests/chat/context.test.ts.

**Interfaces:** `retrieveMemory(db,query):{facts:MemoryRecord[];ambiguousProjects:string[]}`; export `createContextBuilder(deps):ContextBuilder`, where `ContextBuilder=(input:TurnInput,signal:AbortSignal)=>Promise<ContextBundle>`. Dependencies include stores, queue, and actual model descriptor lookup. Preserve spec `ContextBundle`; add optional `compacted` metadata for backend evidence if needed.

- [ ] Write 20 fixed independent scenarios spanning global/active/referenced/unscoped facts, aliases/ambiguity, cross-project comparison, paraphrases, exclusions and statuses before implementing retrieval.
- [ ] Write failing context tests for exact UTF-8 budget, oversize current-prompt rejection, cancelled/failed attempt omission, compaction, pending-memory evidence after bounded wait, deletion recheck, and untrusted data boundaries.
- [ ] Implement FTS5+scope/alias+recency retrieval, max 12 facts/4 global/8 KiB. Do not silently promote arbitrary unrelated project facts. Return ambiguity for caller clarification.
- [ ] Implement current input → fixed instructions → memories → recent complete turns → bounded summary under `min(24 KiB,floor(model.inputBudgetTokens*0.70) bytes)`. No silent current-input truncation. Preserve chronological message order; record selected IDs and updating/compaction.
- [ ] Pass at least 18/20 positive scenarios and all exclusion/deletion/contradiction cases; report lexical limitations accurately. Run full tests/typecheck; commit `feat: assemble shared context`.

### Task 4: Chat orchestration and backend service

**Files:** `desktop/chat/orchestrator.ts`, `desktop/backend.ts`, `desktop/providers/{registry,routes}.ts`, `desktop/ipc.ts`, tests/chat/orchestrator.test.ts, tests/desktop/bridge.test.ts, tests/backend.test.ts.

**Interfaces:** parent Task 3 orchestrator `send/cancel/retry`; `createBackend({databasePath,adapters?})` composes stores/context/queue, exposes typed `JarvisBridge` commands and `close():Promise<void>`. Supplied adapters are internal construction-time dependencies, never renderer inputs. Default registry advertises actual unavailable routes and empty model lists until an eligible adapter is implemented. Main-process `registerBackendIpc({ipcMain,backend,isTrustedSender})` validates sender+payload and has a deterministic dispose.

- [ ] Test concurrent streams, deduplicated send, fixed model per run, cancellation, deleted-chat late output, retried attempts, errors without fallback, terminal flushing, abrupt EOF, graceful shutdown and restart interruption.
- [ ] Observe failures; implement per-run cancellation, 250ms flush, durable states, completed-turn memory scheduling, full query context build, account disconnect cancellation, chat/project deletion ordering, event subscriptions/unsubscription.
- [ ] Persist context provenance on runs. Implement and validate narrow bridge routes only; reject arbitrary invoke/shell/file commands and forged sender/payloads. Do not create or change a BrowserWindow/frontend in this backend slice.
- [ ] Build default gated provider registry from the access-evidence record. Absent commercial/local eligibility is an explicit unavailable error, never a simulated response or paid API alternative. Test adapters live only in tests.
- [ ] Run tests/typecheck/full frontend build; commit `feat: orchestrate backend chat`.

### Task 5: Backend integration verification and handoff

**Files:** `scripts/backend-smoke.ts`, `docs/testing/backend-acceptance.md`, `docs/research/2026-10-21-subscription-access-validation.md`; backend integration tests.

**Interfaces:** `npm run smoke:backend` opens a temporary database, exercises real persistence/service and reports provider availability without credentials or paid inference. `npm run typecheck:backend` and `npm run test:backend` are maintained entry points.

- [ ] Exercise the assembled backend with controlled subscription transports only in tests: A→B→A, persisted memory recall after restart in fresh chat, cross-project source attribution, correction/forget/delete, auth/quota errors, pending update.
- [ ] Add smoke command for real stores and default route status, clearly labeled no live inference; clean its own temporary files.
- [ ] Verify installed Electron can load native SQLite or explicitly document rebuild/runtime prerequisite if the backend is currently Node-tested only; no packaging success claim without proof.
- [ ] Run full tests, backend typecheck, frontend build, smoke and final review. Record exact results and live integration dependencies. Mark only backend subtasks complete in parent plan.
- [ ] Commit evidence and concise usage documentation. Leave frontend/billing/packaging for their respective tasks.

## Unresolved questions

- Provider eligibility for the paid app and any local prototype route: access-validation outcome.
- Live authentication once supported routes are established.
