# Jarvis Shared Memory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS text-chat MVP using existing ChatGPT and Claude subscriptions, then launch it as a monthly paid app with model switching and automatically maintained memory across conversations and projects.

**Architecture:** Extend the existing React/Vite shell with an Electron main process. SQLite owns transcripts, project labels, runs, and shared memory; subscription adapters receive app-assembled context. Automatic memory extraction and scoped retrieval sit behind the same typed desktop bridge as chat.

**Tech Stack:** Existing React 18/TypeScript/Vite/Vitest; Electron, electron-vite, electron-builder, better-sqlite3 with FTS5; Playwright for desktop acceptance. Pin supported dependency versions at implementation and verify the native SQLite module in packaged Electron.

**Spec:** [Jarvis MVP design](../specs/2026-10-21-jarvis-mvp-design.md)

## Global Constraints

- First pair: ChatGPT + Claude, confirmed during planning.
- MVP scope: text chat + switching + memory, confirmed during planning.
- macOS first; preserve and extend the existing React/Vite UI.
- One user, one Mac, local storage. No team accounts or cloud sync.
- No separate paid API or hidden provider fallback.
- No content telemetry in MVP.
- Commercial launch: users pay a monthly Jarvis subscription for the app and shared memory, while retaining their separate AI subscriptions.
- The founder has both ChatGPT and Claude subscriptions available for the access test; exact plan eligibility still needs verification.
- One active run per chat; independent chats may run concurrently.
- Keep at most 12 retrieved facts, including at most 4 global facts, within 8 KiB UTF-8.
- Before another turn, wait up to 10 seconds for already queued updates relevant to its context.

## Review Focus

1. Overlapping chats, cancellation, deletion, or crash → events never land in the wrong chat or revive removed data; Tasks 2/3.
2. Immediate model switch while extraction is pending → newest user context remains available with an honest updating state; Tasks 4/5.
3. Conflicting facts and out-of-order extraction → source order wins explicit corrections; manual edits survive; Task 4.
4. Forget/delete followed by restart or queued-job completion → no saved-memory resurrection; Tasks 2/4/5.
5. Multibyte over-budget prompts, ambiguous projects, and quoted instructions → bounded context, no arbitrary project selection or instruction promotion; Task 5.

---

## Milestones and dependencies

| Order | Deliverable | Completion evidence |
| --- | --- | --- |
| 0 | [Subscription access spike](2026-10-21-subscription-access-spike.md) | Founder accounts work; A → B → A; entitlement verified; paid-app eligibility assessed separately |
| 1 | Desktop + durable storage | Typed bridge, database restart, legacy import |
| 2 | Real unified chat | Streaming, picker, stop/retry, account errors |
| 3 | Automatic shared memory | Fresh-chat/restart recall; corrections and deletion |
| 4 | Packaged pilot | Two real accounts, cross-project acceptance, usable macOS build |
| 5 | Monthly paid launch | Both commercial integration paths established; billing/entitlement acceptance passes |

Tasks 1/2 and memory logic with fakes can proceed independently of provider approval. Task 3 live acceptance and Task 6 require milestone 0. This dependency cannot be satisfied by mocks.

The founder has the two test accounts; customer inference must always use each customer's own accounts. Start commercial eligibility work in milestone 0. Local prototype success does not resolve paid distribution. Task 7 adds app billing after the core is validated; a no-charge usability pilot can precede it if distribution conditions permit.

Keep this plan and the design together. Use focused subagents for isolated tasks; integrate sequentially where contracts depend on earlier work. Review each task before starting its dependents.

## File ownership

| Area | Files | Responsibility |
| --- | --- | --- |
| Shared boundary | `src/shared/contracts.ts`, `src/shared/domain.ts` | DTOs and canonical records |
| Desktop shell | `desktop/main.ts`, `desktop/preload.ts`, `desktop/ipc.ts`, `desktop/security/secrets.ts` | Window, narrow bridge, credential protection |
| Providers | `desktop/providers/{types,registry,chatgpt,claude}.ts` | Supplied by access plan; no UI or database ownership |
| Persistence | `desktop/storage/{database,migrations,projects,chats,runs,memory,import}.ts` | Transactions and durable state |
| Chat | `desktop/chat/{orchestrator,context}.ts` | Turn lifecycle and provider-neutral context |
| Memory | `desktop/memory/{extract,queue,retrieve}.ts` | Capture, conflict handling coordination, relevance |
| Existing UI | `src/App.tsx`, `src/components/{Sidebar,ChatView,Composer,ModelPicker}.tsx`, `src/lib/{chats,models}.ts` | Preserve layout; replace simulation |
| New UI | `src/hooks/useChatController.ts`, `src/components/{Connections,ProjectPicker,MemoryPanel}.tsx` | Runtime state and three small surfaces |

Do not scaffold a replacement app. Retire `mockReply` and placeholder catalogs only when the real path is connected. Test fakes belong under `tests/` and are unavailable in release builds.

Before frontend code, locate and invoke the user's required `frontend-design` skill. It was not found in the available skill catalog during planning; resolve that prerequisite before UI edits. Do not silently substitute a differently named skill. Check `brand_assets/` and preserve current styling. Required screenshot helpers were also absent from the observed inventory; locate them, or supply compatible helpers if still absent, before visual verification.

### Task 1: Add a secure desktop runtime and shared contract

**Files:**
- Create: `desktop/main.ts`, `desktop/preload.ts`, `desktop/ipc.ts`, `desktop/security/secrets.ts`, `electron.vite.config.ts`, `tsconfig.desktop.json`, `playwright.config.ts`
- Create/extend: `src/shared/contracts.ts`; create `src/shared/domain.ts`
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- Test: `tests/desktop/bridge.test.ts`, `tests/desktop/secrets.test.ts`, `tests/e2e/desktop.spec.ts`

**Interfaces:**
- Reuse access plan's `ProviderId`, `ModelRef`, `ModelDescriptor`, `TurnInput`, `RunEvent`, `ContextBundle`, and `SubscriptionAdapter`; do not redefine incompatible copies.
- Domain DTOs: `ProjectRecord {id,name,aliases,createdAt}`, `ChatRecord {id,projectId:string|null,title,updatedAt}`, `MessageRecord {id,chatId,role,content,sourceSequence:number|null,createdAt,runId:string|null}`, `RunRecord {id,chatId,requestId,userMessageId,assistantMessageId,model,state,error:string|null}`, and `ChatSnapshot {chat:ChatRecord,messages:MessageRecord[],runs:RunRecord[]}`. Use types from the spec for `role`, `model`, and `state`; timestamps are UTC ISO strings.
- Produce `JarvisBridge` groups: `accounts` (list/connect/disconnect/models), `projects` (list/create/delete), `chats` (list/create/get/delete), `runs` (`send(TurnInput)`, `cancel(runId)`, `retry(runId,requestId)`, `onEvent(listener)`), `memory` (list/edit/forget/restore), `legacy.importJson(json:string)`. ID-taking methods receive strings; mutation DTOs are validated in main.
- Bridge signatures: `accounts.list():Promise<{providerId:ProviderId;state:ConnectionState}[]>`, `accounts.connect(id:ProviderId):Promise<void>`, `accounts.disconnect(id:ProviderId):Promise<void>`, `accounts.models():Promise<ModelDescriptor[]>`; project/chat/memory groups use the store signatures in Tasks 2/4 wrapped in Promises. `runs.send`/`retry` return `Promise<{runId:string}>`, `runs.cancel` returns `Promise<void>`, `runs.onEvent(listener:(event:RunEvent)=>void):()=>void`; `legacy.importJson` returns the import result from Task 2.
- Produce `SecretStore { get(key:string):Promise<string|null>; set(key:string,value:string):Promise<void>; delete(key:string):Promise<void> }`, implemented with async Electron safeStorage and an owner-readable app-data file only if a provider route needs app-owned secrets.

- [ ] Add failing tests: unknown IPC channel/sender rejected; malformed `TurnInput` rejected; bridge has no arbitrary invoke, filesystem, token, or shell method. Secret-store fixture asserts encrypted bytes differ from plaintext and unavailable encryption fails closed. Desktop launch asserts `window.require` is absent.
- [ ] Run `npm test -- tests/desktop`; expect missing runtime/bridge failures.
- [ ] Implement the shell, contract validation, and narrow preload bridge. Set `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; deny unexpected navigation/windows. Open provider auth only through the documented route. Keep persisted data in Electron's userData directory. Add restrictive CSP suitable for bundled UI.
- [ ] Add scripts `dev:desktop`, `build:desktop`, `test:desktop` (Playwright Electron), and `package:mac` (electron-builder). Preserve `npm run build` and `npm test`; include desktop typechecking in `build:desktop`. Keep build outputs out of git.
- [ ] Run desktop unit tests, `npm run build:desktop`, and `npm run test:desktop -- --grep "desktop boundary"`; expect success and no privileged renderer access. At this stage UI can still be the existing demo, visibly identified as such.
- [ ] Commit task files when git is available: `feat: add desktop runtime`. If no repository exists at execution, create a local baseline before implementation commits; do not push.

### Task 2: Persist projects, chats, runs, and legacy data

**Files:**
- Create: `desktop/storage/{database,migrations,projects,chats,runs,memory,import}.ts`
- Extend: `src/shared/domain.ts`, `desktop/ipc.ts`
- Test: `tests/storage/database.test.ts`, `tests/storage/import.test.ts`, `tests/storage/deletion.test.ts`

**Interfaces:**
- `openDatabase(path:string): Database` and `migrate(db:Database): void`; `Database` is the better-sqlite3 type.
- `createProjectStore(db)` produces `list`, `create(name:string,aliases:string[]):ProjectRecord`, `delete(id:string):void`.
- `createChatStore(db)` produces `list(projectId?:string|null):ChatRecord[]`, `create(projectId:string|null):ChatRecord`, `get(id:string):ChatSnapshot|null`, `delete(id:string):void`.
- `createRunStore(db)` produces `begin(input:TurnInput):RunRecord`, `appendDelta(runId:string,text:string):void`, `finish(runId:string,state:RunState,error?:string):void`, `retry(runId:string,requestId:string):RunRecord`, `recoverInterrupted():number`.
- `importLegacyChats(db:Database,json:string): { imported:number; skipped:number; rejected:number }`.
- Memory schema defined now: scope, normalized subject/key, value, keywords, status, manual-edit flag, revision, source IDs/sequence; extraction jobs and summaries have a chat ID, cutoff sequence, and revision. Task 4 supplies operations.

- [ ] Add failing behavior tests: reopen temporary database preserves two projects/chat order; repeated `requestId` returns the same run; one active run per chat; two chats can run; source sequence strictly increases globally. Duplicate legacy import creates no duplicates; malformed records are rejected with counts, source JSON unchanged.

  Representative assertions after opening a temporary database and constructing the stores:
  ```ts
  const first = runs.begin(input);
  expect(runs.begin(input).id).toBe(first.id);
  expect(chats.get(input.chatId)?.messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(importLegacyChats(db, legacyJson).imported).toBe(2);
  expect(importLegacyChats(db, legacyJson).imported).toBe(0);
  ```
- [ ] Add deletion/recovery tests: deleted chat's late delta is ignored; source-only facts/jobs/summaries removed; multi-source fact survives with remaining provenance; unfinished runs become interrupted after reopen; completed runs stay complete. Migration failure rolls back and leaves an openable prior database.
- [ ] Run `npm test -- tests/storage`; expect missing schema/store failures.
- [ ] Implement versioned transactional migrations, WAL/foreign keys, stores, and unique constraints. `begin` writes the user message and run atomically. Preserve failed partial replies with their run state; future-context selection will exclude them. Delete through a transaction and make updates to missing runs no-ops.
- [ ] Implement validated idempotent legacy import using original IDs and a migration ledger. Do not rely on Electron sharing the browser's localStorage origin. Keep the old key/file unchanged. Do not silently import corrupt data.
- [ ] Run `npm test -- tests/storage` and `npm run build:desktop`; expect all assertions pass. Add a packaged-Electron SQLite open/reopen check to `tests/e2e/desktop.spec.ts` to catch native ABI issues early.
- [ ] Commit: `feat: persist chats and projects`.

### Task 3: Replace simulated replies with real subscription chat

**Files:**
- Create: `desktop/chat/orchestrator.ts`, `desktop/chat/context.ts`, `src/hooks/useChatController.ts`, `src/components/Connections.tsx`, `src/components/ProjectPicker.tsx`
- Modify: `desktop/main.ts`, `desktop/ipc.ts`, `src/App.tsx`, `src/components/{Sidebar,ChatView,Composer,ModelPicker}.tsx`, `src/lib/{chats,models}.ts`, relevant existing styles
- Test: `tests/chat/orchestrator.test.ts`, `tests/e2e/chat.spec.ts`; update existing `tests/chats.test.ts`, `tests/models.test.ts` for retained behavior

**Interfaces:**
- `ContextBuilder = (input:TurnInput, signal:AbortSignal) => Promise<ContextBundle>`; the initial builder uses stored complete history. Task 5 supplies memory-aware assembly.
- `createOrchestrator({runs,chats,getAdapter,buildContext,onEvent,onCompleted})` produces `send(input:TurnInput):Promise<{runId:string}>`, `cancel(runId:string):Promise<void>`, `retry(runId:string,requestId:string):Promise<{runId:string}>`. `onCompleted(run:RunRecord):void` queues memory work in Task 4.
- `useChatController(bridge:JarvisBridge)` owns snapshots, selected chat/model, run-indexed streaming state, and bridge subscriptions; components receive view state/callbacks, never provider clients.

- [ ] Add failing tests with controlled adapters: A/B chats stream concurrently without crossed messages; duplicate send starts one request; cancellation blocks later deltas; switching picker leaves current run on its original model; retry reuses the user message and creates a new attempt. Auth/quota/network failure surfaces an actionable state without alternate billing.
- [ ] Add UI acceptance assertions: connected model catalog only; unsupported reasoning controls absent; expired connection has reconnect action; Stop cancels; reload restores history; project selection persists. `mockReply`, placeholder model IDs, and fake Auto/Fast/context selectors must not appear in the release path.
- [ ] Run `npm test -- tests/chat/orchestrator.test.ts`; expect missing orchestrator behavior.
- [ ] Implement run lifecycle using persisted run IDs, one AbortController per run, and run-keyed events. Persist deltas every 250 ms and flush on terminal state. Chat/project deletion first cancels all relevant runs from the stored snapshots, then deletes transactionally; discard all late events. Account disconnect cancels that account's active requests and prevents new ones. Build transcript from complete attempts only.
- [ ] Bind existing UI to the bridge and add compact Connections/ProjectPicker surfaces. Add legacy JSON import/export-of-old-data affordance for moving `jarvis.chats` from the prior browser origin. Retain search/new/select/delete UX. Remove simulation from the production path and update helper tests rather than preserving obsolete behavior.
- [ ] Run `npm test`, `npm run build:desktop`, and `npm run test:desktop -- --grep "chat lifecycle"`. After access milestone passes, repeat the A → B → A live demo in the desktop UI and record it. Do not mark real-chat acceptance from fake-adapter tests alone.
- [ ] Commit: `feat: connect subscription chat`.

### Task 4: Maintain durable memory automatically

**Files:**
- Create: `desktop/memory/extract.ts`, `desktop/memory/queue.ts`, `src/components/MemoryPanel.tsx`
- Implement/extend: `desktop/storage/memory.ts`, `src/shared/domain.ts`, `desktop/ipc.ts`, `desktop/main.ts`, `src/App.tsx`
- Test: `tests/memory/extraction.test.ts`, `tests/memory/updates.test.ts`, `tests/memory/deletion.test.ts`

**Interfaces:**
- `CandidateFact = { scope:MemoryScope; subject:string; key:string; value:string; keywords:string[]; sourceMessageIds:string[]; evidence:{messageId:string;quote:string}[]; kind:'assertion'|'correction' }`.
- `MemoryRecord` adds `id`, `status`, `revision`, `manuallyEdited`, `sourceSequence`, `createdAt`, `updatedAt` to the saved fact fields.
- `MemoryUpdate = { summary:string; facts:CandidateFact[] }`.
- `ExtractionInput = { snapshot:ChatSnapshot; previousSummary:string|null; afterSequence:number; throughSequence:number; knownFacts:Pick<MemoryRecord,'id'|'scope'|'subject'|'key'|'value'|'status'>[] }`; `extractMemory(input:ExtractionInput, adapter:SubscriptionAdapter, model:ModelRef, signal:AbortSignal):Promise<MemoryUpdate>` uses a bounded transcript and supported text response, parsing/validating JSON without assuming structured-output support.
- `createMemoryStore(db)` produces `list(scope?:MemoryScope):MemoryRecord[]`, `apply(jobId:string,update:MemoryUpdate):void`, `edit(id:string,value:string,expectedRevision:number):MemoryRecord`, `forget(id:string):void`, `restore(id:string):void`.
- Define shared `RetrievalQuery = { chatId:string; projectId:string|null; text:string }` in `src/shared/domain.ts`.
- `createMemoryQueue({db,memory,getAdapter})` produces `enqueue(run:RunRecord):void`, `drainForContext(query:RetrievalQuery,signal:AbortSignal):Promise<{updating:boolean}>`, `resume():void`, `stop():Promise<void>`. Jobs use persisted message cutoffs and the originating model, not the current picker selection.

- [ ] Add failing extraction tests: explicit preference and project decision produce grounded candidates with valid source IDs; assistant-only claims and quoted “ignore instructions” commands do not become user facts. Explicit adoption of an assistant proposal requires user evidence. Malformed/oversized JSON and invalid project/source IDs fail validation, leave a retryable job, and do not mutate memory.
- [ ] Add update tests: repeated fact merges sources; explicit newer correction wins even if extraction completes first; ambiguous contradiction excludes both assertions; manual edit survives stale extraction; later change to edited fact becomes a review item. Assert by `sourceSequence`, not wall-clock completion time.
- [ ] Add deletion tests: forget persists after restart, reindex, and late jobs; restore is explicit; deleted chat cannot recreate a fact; multi-source fact retains surviving sources. Assert “Forget saved memory” does not claim to redact original messages. Source-chat deletion invalidates its summary.

  Representative assertion using a seeded fact and a queued update for the same subject/key/scope:
  ```ts
  memory.forget(fact.id);
  memory.apply(staleJobId, staleUpdate);
  expect(memory.list().filter(m => m.id === fact.id && m.status === 'active')).toEqual([]);
  ```
- [ ] Run `npm test -- tests/memory`; expect missing extraction/store/queue behavior.
- [ ] Implement extraction and transactional application. Validate schema, source ownership, quoted evidence, scope, lengths, and cutoff/revision before commit; normalize subject/key consistently. Supply relevant existing/tombstoned keys and test that paraphrases reuse them. New candidates cite user messages within `(afterSequence, throughSequence]`, not an older summary. Limit one extraction job per completed turn, deduplicate retries, and never extract facts from failed/partial assistant runs. Bound summary size to 4 KiB UTF-8; older content is represented by the prior summary plus newly completed turns.
- [ ] Implement a durable queue, one update at a time per chat. On failure, retain pending status and retry once on the next relevant turn or reconnect; do not spin or silently switch providers. `drainForContext` waits at most 10 seconds; cancellation interrupts waiting. Determine relevance from the full query and pending user evidence across projects, since extraction has not yet assigned final scope. Test a newly stated global preference from another project while its extraction remains pending.
- [ ] Add MemoryPanel list/source/edit/forget/restore and conflict resolution. Show saving/updating/failed status without interrupting ordinary chat. Explain extra subscription usage and the exact forget/delete boundary. Allow saving a conflict resolution as an explicit authoritative edit.
- [ ] Run `npm test -- tests/memory`, `npm run build:desktop`, and desktop MemoryPanel acceptance. With live accounts, confirm one ordinary chat turn automatically creates an inspectable fact without a save/paste action.
- [ ] Commit: `feat: maintain shared memory`.

### Task 5: Retrieve relevant memory across conversations and projects

**Files:**
- Create: `desktop/memory/retrieve.ts`, `tests/fixtures/memory/scenarios.json`
- Extend: `desktop/chat/context.ts`, `desktop/memory/queue.ts`, `src/components/ChatView.tsx`
- Test: `tests/memory/retrieval.test.ts`, `tests/chat/context.test.ts`, `tests/e2e/memory.spec.ts`

**Interfaces:**
- Consumes `RetrievalQuery` from Task 4's shared domain types.
- `retrieveMemory(db:Database, query:RetrievalQuery): { facts:MemoryRecord[]; ambiguousProjects:string[] }`.
- `buildContext(input:TurnInput, signal:AbortSignal):Promise<ContextBundle>` implements Task 3's `ContextBuilder`, using stores, queue, adapter catalog, and retrieval through construction-time dependencies.
- Record selected memory IDs and compaction/updating state per run; emit the spec's `context` event. ChatView shows an inspectable context indicator.

- [ ] Write 20 fixed retrieval scenarios before tuning: global preference; fresh-chat recall; restart; paraphrase; active project; project alias; two-project comparison; all-project request; unrelated-project negatives; ambiguous alias; corrected/conflicted/forgotten facts; immediate switching during capture. Include prompt, saved facts, expected eligible/excluded IDs, and expected behavior.
- [ ] Add failing assertions: at most 12 facts/4 globals/8 KiB; quoted commands stay delimited data; current prompt never silently truncated; multibyte budgeting uses UTF-8 bytes; failed assistant attempts omitted; ambiguous project alias yields clarification. A fresh chat while extraction hangs includes eligible pending user evidence and `updating:true` after at most 10 seconds. Deletion removes that evidence before the next send.

  Representative retrieval assertions for a two-project fixture:
  ```ts
  const result = retrieveMemory(db, query);
  expect(result.facts.map(f => f.id)).toContain(relevantFact.id);
  expect(result.facts.map(f => f.id)).not.toContain(unrelatedFact.id);
  expect(result.facts.length).toBeLessThanOrEqual(12);
  expect(result.facts.filter(f => f.scope.kind === 'global').length).toBeLessThanOrEqual(4);
  ```
- [ ] Run `npm test -- tests/memory/retrieval.test.ts tests/chat/context.test.ts`; expect missing memory-aware context behavior.
- [ ] Implement central FTS5 retrieval with scope/name/alias matching and recency ranking. Use global + active project + explicitly referenced project candidates; unscoped queries may find relevant facts across the central index. Never dump all project memories. Exclude conflicted/deleted/superseded facts and attribute each retained project fact.
- [ ] Implement context assembly with the spec's byte/token budget and priority order. Include pending source evidence if capture is delayed; label it unverified. Place retrieved facts/summary in delimited data under fixed instructions, not executable system directives. Compact old history, preserve full local messages, and disclose compaction. Reject over-budget current input before sending or consuming subscription usage.
- [ ] Run the fixture evaluation: at least 18/20 relevant-memory scenarios and every wrong-project/deletion/contradiction negative case must pass. If FTS misses this bar, record failures and revise retrieval with measured semantic-search work before release; do not lower the bar or claim semantic recall from lexical tests.
- [ ] Run `npm test`, `npm run build:desktop`, and `npm run test:desktop -- --grep "shared memory"`. Live acceptance: fact learned using ChatGPT → quit/reopen → fresh Claude chat; then compare two projects and verify attribution. Inspect actual assembled context as well as the model answer to distinguish retrieval failure from generation variance.
- [ ] Commit: `feat: recall memory across projects`.

### Task 6: Package and validate the smallest useful pilot

**Files:**
- Create: `docs/testing/mvp-acceptance.md`, `docs/testing/pilot-script.md`
- Extend: `tests/e2e/{desktop,chat,memory}.spec.ts`, `package.json`, packaging configuration
- Locate/create if absent: `serve.mjs`, `screenshot.mjs` with the user's required invocation/output behavior
- Visual artifacts: `temporary screenshots/` (local, excluded from commits)

**Interfaces:**
- Consumes completed access gate and Tasks 1–5.
- Produces an installable macOS artifact plus an evidence record containing version, architecture, test commands/results, synthetic scenario outcomes, known limits, and distribution status.

- [ ] Add end-to-end cases for remaining release risks: login expired/reconnect, quota error, mid-stream close/restart, project deletion during extraction, account disconnect, and database migration rollback. Use fault-injection fixtures for destructive/network conditions; label these separately from live checks.
- [ ] Run `npm test`, `npm run build`, `npm run build:desktop`, `npm run test:desktop`, and `npm run package:mac`. Expect all automated checks to pass; launch the packaged app and confirm SQLite/native dependencies, authentication, and a live two-provider memory demo. A successful development server is insufficient packaging evidence.
- [ ] Verify the UI on localhost using the existing helpers if found. Otherwise supply compatible helpers without replacing present files: `node serve.mjs` serves the project at `http://localhost:3000`; `node screenshot.mjs http://localhost:3000 <label>` writes incremented PNGs under `temporary screenshots/`. Do not run a second server on an occupied port. Use deterministic test data with no credentials for browser-only visual checks; confirm the actual Electron UI separately.
- [ ] Complete at least two screenshot/inspection rounds against the existing UI baseline, checking layout, typography, spacing, loading/error states, and the new panels. Fix mismatches before the second round; recheck after additional changes. Invoke `frontend-design` before associated UI edits. No `file:///` screenshot workflow.
- [ ] Record every defining-demo acceptance row from the design. Include source IDs and selected-context evidence for corrections/deletion. Mark unsupported native Chat/Work/Cowork features and native-history sync as outside the agreed text MVP; do not market them as implemented.
- [ ] Before external distribution, establish eligibility for both integrations, signing/notarization, and an installer test on a clean supported Mac. If those dependencies are unresolved, label the output a local prototype rather than a shippable pilot.
- [ ] Prepare the user-run pilot: five people already paying for both supported subscriptions; one week; ask each to switch providers, restart into a fresh chat, work across two projects, and correct/forget a fact. Proposed success: at least four complete the defining demo without manual transfer. Capture opt-in feedback without content telemetry. No invitations/messages are sent by this plan.
- [ ] Commit release artifacts/configuration and evidence, excluding binaries/secrets/screenshots: `chore: prepare mac pilot`.

### Task 7: Add monthly app billing before paid release

**Files:**
- Create: `docs/superpowers/specs/2026-10-21-jarvis-paid-launch-design.md` and its task-level implementation plan once payment provider, price, and offline policy are selected.
- Planned boundaries: `desktop/licensing/entitlement.ts`, `src/components/SubscriptionPanel.tsx`, `desktop/storage/export.ts`, and a minimal hosted billing/entitlement service. Keep payment-provider-specific server paths in the paid-launch plan.
- Acceptance record: `docs/testing/paid-launch-acceptance.md`

**Interfaces:**
- Billing service owns monthly status and paid-through time; desktop reads a verified entitlement distinct from provider OAuth status. Never trust renderer flags or checkout redirects as proof of payment.
- The billing service receives account/payment metadata only, not provider tokens, chat text, or memory.

- [ ] After core validation, choose one monthly price, a hosted payment provider, and the offline/recheck policy. Write the focused billing design and implementation plan before adding billing code; keep one plan and no usage-based inference resale.
- [ ] Implement hosted checkout and subscription management with verified, idempotent billing events and server-validated entitlement. Keep provider connection errors separate from Jarvis payment state.
- [ ] Test checkout success/failure, renewal, duplicate/out-of-order events, forged checkout redirect, cancellation at paid-period end, payment failure, expiry, and entitlement recovery after an outage. Require deterministic acceptance for each transition before enabling charges.
- [ ] On expiry, stop new inference/background extraction while preserving readable/exportable local data. Add a versioned JSON export for chats, projects, and memory, excluding credentials. Confirm cancellation never deletes history.
- [ ] Establish commercial eligibility for both integrations and finish signing/install acceptance before the paid release. A no-charge prototype or pilot does not complete this task.

This is a bounded later workstream: its detailed interfaces depend on the selected payment provider. It does not delay the supported local prototype or replace the subscription-access gate.

## Completion checklist

- [ ] ChatGPT and Claude both use verified existing-subscription routes.
- [ ] One interface switches models without manual context transfer.
- [ ] Memory captures automatically and survives new chats/restarts.
- [ ] Multiple projects share useful context with correct attribution.
- [ ] Correction, manual edit, forget, and source deletion behave as specified.
- [ ] No production mocks, fake model settings, or hidden API fallback.
- [ ] Packaged macOS build passes live acceptance; pilot/distribution status explicit.
- [ ] Paid release additionally passes commercial integration and monthly billing acceptance.

## Unresolved questions

- Paid integration eligibility: OpenAI and Claude access-spike outcomes.
- Before billing implementation: price, payment provider, offline policy?
