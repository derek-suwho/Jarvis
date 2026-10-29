# Background Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** Continue AI work across chats, queue instructions, optionally interrupt/apply/resume, and notify on final outcomes.

**Architecture:** A main-process coordinator owns task sessions, queues, attempt identity, and notification decisions. React subscribes to revisioned snapshots and persists task-owned messages through existing localStorage/IndexedDB. Provider adapters expose explicit interruption checkpoints; no full database migration.

**Tech Stack:** Existing Electron 44, React 18, TypeScript, CommonJS main modules, Vitest, Puppeteer; no new dependency.

**Spec:** [Background tasks design](../specs/2026-10-24-background-tasks-design.md). Read it before implementation. This plan is proposed; no product code has been changed.

## Global Constraints

- Queueing and interrupting are separate actions. An ordinary queued message must not silently abort the current response.
- Freeze provider/model, mode, reasoning, personal/project instructions, history, media, and side-chat context when a task starts.
- At most three provider attempts run concurrently; additional tasks wait FIFO.
- Bound intake at 20 waiting tasks globally, 20 queued messages per task, and the existing 20 MiB serialized request limit.
- Generated output plus tool continuation data is capped at 4 MiB per task; exceedance fails visibly and preserves partial output.
- Checkpoint active output at 250 ms, flush terminal and accepted-message changes immediately, and acknowledge the task revision only after the save succeeds.
- Keep current platform window-close behavior; do not promise work survives process exit.
- Preserve current uncommitted work. No provider credentials or paid model calls in automated fixtures. Existing UI styling and attachment limits remain.

## Review Focus

- Queue/finish race: accepted instructions continue once; rejected ones stay in the draft. Tasks 1, 4, 5.
- Interrupt during tool effects: no replay, overlap, or false cancellation claims; unknown outcome retains queue. Tasks 2, 3.
- Reload amid asynchronous saving: snapshots merge once without overwriting metadata, feedback, or newer drafts. Tasks 4, 5.
- Delete/undo/clear-all during work: late events cannot restore deleted messages or tasks. Tasks 1, 4, 7.
- Claude child acknowledges interruption but exits slowly or omits session information: no overlapping resume or success notification. Task 3.

## File and interface map

Create `src/shared/tasks.ts`, `electron/tasks/{coordinator,ipc,notifications}.cjs`, `src/lib/{tasks,taskProjection}.ts`, and `src/components/{TasksPanel,TaskQueue}.tsx` plus scoped CSS. Modify the existing adapters, preload/main, App/composer/sidebar/tab/settings integration and chat/draft persistence. Retire singleton reply ownership from `src/useReplyStream.ts` and `src/lib/providerClient.ts`; retain account/model helpers and an explicit preview adapter.

Define these shared contracts in Task 1; subsequent tasks consume them:

```ts
type TaskTarget = { kind: 'chat' | 'sidechat'; id: string; generation: string; ephemeral: boolean };
type TaskState = 'queued' | 'running' | 'interrupting' | 'stopping' |
  'complete' | 'cancelled' | 'failed' | 'interrupted';
type QueueEntry = { id: string; message: Message; sequence: number;
  state: 'queued' | 'applying' | 'applied' | 'cancelled' };
type TaskRequest = { requestId: string; target: TaskTarget; title: string;
  history: Message[]; input: Message; instructions: string; modelLabel: string;
  provider: 'chatgpt' | 'claude' | 'preview'; model: string;
  mode?: 'chat' | 'code'; reasoning?: string; creation?: Chat; retryOf?: string };
type TaskSnapshot = { id: string; requestId: string; target: TaskTarget;
  state: TaskState; revision: number; createdAt: number; updatedAt: number;
  title: string; modelLabel: string; messages: Message[]; queue: QueueEntry[];
  unread: boolean; error?: string; creation?: Chat; retryOf?: string };
type TaskEvent = { type: 'snapshot'; task: TaskSnapshot } |
  { type: 'removed'; taskId: string; target: TaskTarget; revision: number };
type TaskResult = { ok: true; task: TaskSnapshot } |
  { ok: false; code: string; message: string };
```

`Message` gains optional `taskId`, `attemptId`, `taskRevision`, `outcome` (`complete | interrupted | cancelled | failed`), and `delivery` (`queued | applying | applied | cancelled`). Existing messages without fields remain valid. A task's queue references the same user-message IDs as its ordered projection. Applying includes protocol acceptance, not merely removing a queue row.

Provider adapter interface (main-only; continuation never crosses IPC):

```ts
type AttemptResult = { kind: 'complete' | 'interrupted' | 'failed';
  continuation?: unknown; error?: string; uncertainEffects?: boolean };
type AttemptHandle = { settled: Promise<AttemptResult>;
  interrupt(): void; stop(): void };
// openAttempt({ request, continuation?, updates, attemptId }, emit) -> AttemptHandle
// emit receives existing delta/tool events; settled is authoritative for lifecycle.
```

Bridge/coordinator methods: `start(TaskRequest)`, `queue({taskId, entryId, message})`, `removeQueued({taskId, entryId})`, `interrupt(taskId)`, `stop(taskId)` return `Promise<TaskResult>`; `snapshot()` returns task snapshots; `ack({taskId, revision})`, `forgetTarget(target)`, `detach(taskIds)`, `markRead(taskId)`, `setVisibleTargets(targets)`, `setPreferences({desktopTaskNotifications})`, and `ready()` return `Promise<void>`. `onEvent` and `onOpenTarget` return unsubscribe functions. Retry calls `start` with current validated history and `retryOf`.

### Task 1: Coordinator and task contracts

**Files:** create `src/shared/tasks.ts`, `electron/tasks/coordinator.cjs`, `tests/tasks/coordinator.test.ts`; modify `src/lib/chats.ts` message type only.

**Interfaces:** consumes injected `openAttempt`, clock, IDs, event sink; produces `createTaskCoordinator(deps)` with the methods above and `shutdown()`/`destroyOwner(ownerId)` for main lifecycle.

- [ ] Write failing deterministic tests using deferred attempt handles. Assertions: starting A and B yields two open attempts; queueing A calls neither `interrupt` nor `stop`; interrupt captures only current queued IDs; later queue entries remain; completion with queue opens continuation and emits no terminal outcome; duplicate IDs return same result; terminal snapshots ignore old attempt events.
- [ ] Run `npx vitest run tests/tasks/coordinator.test.ts`; expect missing-module/test failures before implementation.
- [ ] Implement command serialization, three-slot scheduler, exclusive Claude code lane, FIFO fairness, all state transitions, limits, revisions, per-target generations, queue removal and shutdown. Reject before consuming any input; release slots only when `settled` resolves.
- [ ] Add assertions for 20/21 queue limits, malformed messages, queued/stop/finish races, stale callbacks, failed cleanup, forgotten generations, and snapshot pruning only after terminal ack. Run the same test file; expect pass.
- [ ] Commit only task-owned files: `feat: coordinate tasks`.

### Task 2: Interruptible ChatGPT session

**Files:** modify `electron/chatgpt-inference.cjs`, `electron/tools/host.cjs`; create `tests/tasks/chatgpt-session.test.ts`; extend `tests/chatgpt-inference.test.ts` where shared validation changes.

**Interfaces:** consumes coordinator attempt input; exports `openAttempt` returning the common handle. Continuation retains native input and complete tool-call/result pairs; provider credentials stay main-only.

- [ ] Write failing transport tests: queue alone does not abort; interrupt cancels only current HTTP stream; resumed input contains original context + labelled partial + queued messages once; interrupted attempt emits no ordinary failure. During a deferred tool, assert no continuation starts until its result and no second old-plan tool runs.
- [ ] Run `npx vitest run tests/tasks/chatgpt-session.test.ts tests/chatgpt-inference.test.ts`; confirm new tests fail for intended behavior.
- [ ] Split response request lifetime from task lifetime; preserve resumable native input, cancelled unstarted calls, structured tool outcome/timeout information, and cancellation checks before every tool/model dispatch. Propagate optional tool cancellation where supported, without declaring unconfirmed external effects rolled back.
- [ ] Assert completed tool call counter remains one after interruption, interrupted model text is labelled, unknown tool outcome retains updates, truncated streams fail, and full media/request limits still apply. Run both files plus `tests/tools.test.ts`; expect pass.
- [ ] Commit: `feat: steer ChatGPT tasks`.

### Task 3: Claude interruption and exact-session resume

**Files:** modify `electron/claude-code.cjs`; create `tests/tasks/claude-session.test.ts`, `scripts/check-claude-interruption.mjs`; extend `tests/claude-code.test.ts`.

**Interfaces:** exports the same `openAttempt`; continuation contains exact session ID, accepted input boundary, and observed tool outcome state. Ordinary successful session caching remains compatible.

- [ ] Write failing child-process tests: interruption sends SIGINT; continuation waits for result and process settlement; next spawn uses `--resume` with the exact session ID and queued text/media once. Abort during async CLI/tool setup must never spawn.
- [ ] Run `npx vitest run tests/tasks/claude-session.test.ts tests/claude-code.test.ts`; confirm intended failures.
- [ ] Implement explicit interrupt/stop distinction, result/session capture, five-second grace timeout, termination and listener cleanup, conservative unknown-effect reporting, and context-preserving resume. Do not infer safe interruption from missing tool events; do not reuse a digest that omits queued messages or partial output.
- [ ] Add fixtures for missing result/session, delayed exit, ignored SIGINT, broken stdin, tool already dispatched before stdout, stop during interrupt, and native PDF/image blocks. Assert failed interrupt retains queued content and never launches a second process. Run both test files; expect pass.
- [ ] Add opt-in compatibility script for installed Claude CLI interruption/session continuation using an isolated temporary workspace and harmless text-only prompt, tools disabled. It must be explicitly enabled before using the account. Record installed version (`2.1.310` observed during planning), exit/result sequence, and actual resume success; version alone is not proof. Keep ordinary test suite offline. If unverified, disclose this limit; do not claim native compatibility passed.
- [ ] Commit: `feat: steer Claude tasks`.

### Task 4: IPC, renderer hydration, and existing persistence

**Files:** create `electron/tasks/ipc.cjs`, `src/lib/tasks.ts`, `src/lib/taskProjection.ts`, `tests/tasks/{ipc,projection}.test.ts`; modify `electron/{main,preload}.cjs`, `src/lib/{desktop,chats,replyContext}.ts`, `src/main.tsx`, `tests/chats.test.ts`, `tests/reply-context.test.ts`.

**Interfaces:** preload exposes `window.jarvis.tasks`; task client provides stable external-store snapshots/subscription and the bridge methods. `applyTaskSnapshot(chats, task): Chat[]` merges by IDs/revision; `saveChats(chats): Promise<void>` acknowledges actual durable save.

- [ ] Write failing tests: subscribe-before-snapshot reorders revisions correctly; rehydrating twice does not duplicate messages; newer feedback/title/project remain; media saves precede metadata; unacknowledged output is retained after save failure; webview and foreign-frame IPC requests are rejected.
- [ ] Run `npx vitest run tests/tasks/ipc.test.ts tests/tasks/projection.test.ts tests/chats.test.ts tests/reply-context.test.ts`; confirm new failures.
- [ ] Register coordinator once at app startup, validate all IPC inputs, normalize snapshots and ready/navigation delivery. Coalesce saves with terminal/acceptance flush, acknowledge only successful revision writes, fence deletion/detach generations, and mark saved active records interrupted only after authoritative main snapshot is loaded. Preview adapter uses same contract in memory.
- [ ] Assert delete/undo/delete-all/settled-edit cannot resurrect old output; ephemeral targets never enter Jarvis storage; cancelled/unapplied messages do not reach future provider context; stopped partials are labelled. Run targeted files and `npm run build`; expect pass.
- [ ] Commit: `feat: sync task state`.

### Task 5: Queue composer and concurrent conversation integration

**Files:** create `src/components/{TaskQueue.tsx,TaskQueue.css}`, `tests/tasks/client.test.ts`; modify `src/App.tsx`, `src/useReplyStream.ts`, `src/lib/{providerClient,drafts}.ts`, `src/components/{Composer,ChatView,TabPanel,MessageItem}.tsx`, relevant CSS, `tests/drafts.test.ts`, `scripts/check-stream-flows.mjs`.

**Interfaces:** App commands return `Promise<TaskResult>`; composer accepts idle/running task state and explicit queue/interrupt/stop callbacks. Draft helpers add revision capture and `consumeSubmittedDraft(key, submitted): void` that preserves later edits/files.

- [ ] Add failing draft tests: rejection leaves text/files intact; acknowledgement removes submitted content only; navigating while submission is pending cannot clear another draft. Extend simulated transport with queued entries and explicit interrupt receipts.
- [ ] Run `npx vitest run tests/drafts.test.ts tests/tasks/client.test.ts`; confirm intended failures.
- [ ] Replace main/side singleton controllers with target-scoped task subscriptions. Implement Queue message, queued list/Remove, Interrupt & apply, independent Stop, honest statuses and partial outcome labels. Route navigation/side-close/delete/edit/regenerate through target lifecycle without cancelling unrelated work.
- [ ] With `node serve.mjs` already running or started once, run `node scripts/check-stream-flows.mjs`. Assert A/B and two side chats continue; queueing does not abort; explicit interruption resumes correct context; fresh inputs during interruption stay queued; Stop affects one target; async rejection preserves draft; media and frozen project instructions survive.
- [ ] Commit: `feat: queue and apply instructions`.

### Task 6: Task status and notifications

**Files:** create `electron/tasks/notifications.cjs`, `src/components/{TasksPanel.tsx,TasksPanel.css}`, `tests/tasks/notifications.test.ts`; modify `electron/main.cjs`, `src/App.tsx`, `src/components/{Sidebar,TabPanel,SettingsDialog,Icons}.tsx`, `src/lib/preferences.ts`, `tests/preferences.test.ts`, relevant CSS.

**Interfaces:** `createTaskNotifications({isFocused, openTarget, createNotification, emitNotice})` consumes terminal snapshots, visibility and preference updates; `TasksPanel` consumes task summaries and open/stop/read handlers. Add `desktopTaskNotifications: boolean`, default true.

- [ ] Write failing notification tests: final outcome alerts once; natural queue continuation and manual interruption never alert; focused visible main/side targets suppress alerts; unfocused persistent tasks attempt native delivery; ephemeral tasks never create native notifications.
- [ ] Run `npx vitest run tests/tasks/notifications.test.ts tests/preferences.test.ts`; confirm intended failures.
- [ ] Implement Tasks popover, active count, per-target status/unread, separate outcome notices, preference hydration, generic silent native copy, reference cleanup, readiness-gated click routing, and unsupported/failure fallback. Reuse current styles; keep undo/storage-error toast intact.
- [ ] Assert native click routes exact target after reload; deleted target cannot resurrect; preference off and notification failure preserve unread in-app state; old preference objects migrate. Run targeted tests; expect pass.
- [ ] Commit: `feat: notify task outcomes`.

### Task 7: Integrated verification and visual review

**Files:** create `scripts/check-task-lifecycle.mjs`, extend `scripts/check-stream-flows.mjs`, update `package.json` UI test command if needed; record results in this plan.

**Interfaces:** Electron fixture launches real main/preload with injected fake providers and isolated userData; never imports account state or starts live MCP tools.

- [ ] Add integration cases proving a task survives renderer destruction/recreation, no provider starts on process restart, ephemeral destruction cancels, IPC rejects guest frames, and notification clicks wait for renderer readiness. Run `node scripts/check-task-lifecycle.mjs`; expect pass.
- [ ] Run `npm test`, `npm run typecheck:backend`, `npm run build`, `npm run test:ui`, `node scripts/check-media-flows.mjs`, `node scripts/check-media-persistence.mjs`. Investigate failures; do not rerun broad suites without changes or unresolved concerns.
- [ ] Use `node screenshot.mjs http://localhost:3000 tasks-round-1`; inspect PNG with `view_image`. Capture queue, interrupting, background completion, Tasks popover, and notification preference at desktop dark/light and narrow width. Compare alignment, typography, spacing, states, and focus against existing app.
- [ ] Fix visible defects; repeat screenshots with `tasks-round-2` and inspect again. Verify keyboard-only queue/remove/interrupt/stop/open flow and reduced motion.
- [ ] Request independent review of touched behavior and spec coverage. Resolve material findings, then run affected tests only. Commit verification changes: `test: verify task lifecycle`.
- [ ] Report implemented behavior, test evidence, two screenshot rounds, and any unverified live-Claude/native-notification limits. Do not claim OS notification delivery from a mock or unsigned development build.

## Execution order and review

Implement Task 1 first. Tasks 2 and 3 can be delegated independently against its fixed attempt contract. Integrate Task 4, then Task 5; Task 6 follows the stable client contract. Task 7 verifies the combined behavior. Recommend subagents for provider adapters and independent final review, consistent with the user's repository instructions.

Self-review: each spec behavior maps to a task; the five Review Focus risks have explicit tests. Preview behavior, discard rules, current-context retry, notification lifetime, and persistence limitations are intentional. Baseline tests/build passed before changes; that is not implementation proof.

## Unresolved questions

None required. Review the proposed defaults and queue/interrupt behavior before implementation.
