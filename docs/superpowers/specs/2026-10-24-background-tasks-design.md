# Background tasks, notifications, and steering

Status: proposed design, revised after user clarification. Product code unchanged.

## Confirmed behavior

Background tasks are AI work that continues while the user switches chats or does something else. Sending a message while the AI works queues that message. The user can choose to interrupt, put queued messages into context, and resume the AI's work.

Queueing and interrupting are separate actions. An ordinary queued message must not silently abort the current response. Steering preserves the original task and adds the user's new direction.

## Existing implementation and architecture choice

`src/useReplyStream.ts` holds one main-chat stream. `src/App.tsx` holds a second singleton for side chats. Sending elsewhere aborts prior work. Providers can execute concurrently, but send output only to the original renderer and retain no recoverable result. Chat history lives in localStorage, media in IndexedDB. The separate SQLite backend is not wired into production and lacks current rich-message features.

| Option | Tradeoff |
| --- | --- |
| Renderer registry | Smallest change; handles switching chats but loses ownership on reload |
| Main-process task coordinator | Owns cancellation, queueing, notifications, and reload snapshots consistently |
| Durable worker + chat database migration | Adds quit/restart recovery and substantial migration work beyond requested background behavior |

Recommend a main-process coordinator with in-memory snapshots, using existing chat persistence. No new dependency, separate worker service, or database migration. Running tasks survive chat changes, minimization, focus loss, and renderer reload while the app process exists. Execution after explicit Quit/restart is out of scope. Keep current platform window-close behavior; do not promise work survives process exit.

## Task model

One task represents one original user request plus its queued instructions and successive provider attempts. Stable task IDs differ from attempt IDs. One active task per target; a target is an ordinary chat or side chat. At most three provider attempts run concurrently; additional tasks wait FIFO. Claude code-mode tasks share one exclusive workspace lane because the current adapter uses one workspace. A blocked workspace lane does not block independent chat tasks.

States: `queued`, `running`, `interrupting`, `stopping`, `complete`, `cancelled`, `failed`, `interrupted`. Queued user messages have separate `queued`, `applying`, `applied`, or `cancelled` states. The renderer receives monotonic task revisions and never assembles reconnect output by replaying raw text deltas.

Freeze provider/model, mode, reasoning, personal/project instructions, history, media, and side-chat context when a task starts. Model/settings changes affect later tasks. Retain stopped/interrupted answer fragments with explicit status. Old attempts cannot append to new attempts or finish the task. Keep a concurrency slot until the provider actually settles.

Bound intake at 20 waiting tasks globally, 20 queued messages per task, and the existing 20 MiB serialized request limit. Validate the complete prospective request before accepting an update. Generated output plus tool continuation data is capped at 4 MiB per task; exceedance fails visibly and preserves partial output. These are builder defaults, not user-specified numbers.

## Queue and interrupt semantics

1. **Idle:** Send starts a task normally.
2. **Running:** Send queues a message, retaining text/files in FIFO order. It does not interrupt. Display queued messages above the composer with Remove and **Interrupt & apply**.
3. **Task waiting for a slot:** Fold accepted queued messages into its first request in order. No interruption required.
4. **Natural completion:** If queued messages remain, start the next provider attempt using the completed reply plus all queued messages. This remains the same task; only the final empty-queue completion notifies.
5. **Interrupt & apply:** Atomically capture queued message IDs, transition to interrupting, request provider interruption, wait for a valid continuation boundary, insert captured messages, then resume the same task. Messages arriving after the capture remain queued for a later boundary. Disable duplicate interruption while applying; do not discard newer messages.
6. **Stop:** Cancel the task and queued messages. Preserve accepted user content and partial output in chat with cancelled/unapplied status; do not silently lose instructions.
7. **Races:** Main serializes commands per target. If completion wins before queue acceptance, return `task_finished`; preserve the draft so Send can start a normal next turn. If queue acceptance wins, completion must continue the queue. Identical client IDs return the same result; conflicting ID reuse is rejected.

Only label an update applied once included in the next provider request/session input. On validation/provider failure, retain it visibly as unapplied. Remove is allowed only while queued, never once captured for application. Ordinary future context excludes cancelled/unapplied instructions until explicitly resubmitted. Retain all queue/user message IDs so recovery and retries cannot duplicate messages.

## Provider behavior

**ChatGPT:** expose a task session around the existing Responses loop. Separate the attempt's lifetime controller from each HTTP request controller. Interrupt aborts the current model request, retains received text as incomplete, and preserves accumulated native input including completed function-call/output pairs. If a tool is running, queue interruption until that call settles; dispatch no additional old-plan tool calls. Represent planned but unexecuted calls with explicit not-executed results to keep protocol pairs valid, then append queued user messages and continue. Natural completion follows the same queue check. Never rerun a completed tool merely to reconstruct context.

**Claude:** expose the actual session ID and subprocess lifecycle. On Interrupt & apply, send SIGINT to end the current turn, wait for its result/exit, then resume that exact session with queued messages. Do not infer that tools are absent because no tool event has arrived. Do not discard a valid interrupted session and blindly reconstruct/replay its work. SIGTERM remains shutdown/forced-stop behavior; after five seconds without acknowledgement, terminate and mark interruption failed, retaining the queue instead of automatically starting overlapping work. Check aborted state before/after async setup and immediately before spawn; always clean up listeners.

Claude's current documentation distinguishes SIGINT (end the turn) from SIGTERM (leave the turn unfinished). Verify the installed CLI's supported behavior in an adapter compatibility test before declaring this path implemented. If interrupted-session continuation is unavailable, show an actionable error with queued content intact; an unsupported provider must not pretend it resumed. [Claude programmatic usage](https://code.claude.com/docs/en/headless#stop-a-run-with-sigterm).

Both adapters must represent unknown tool outcomes explicitly. If an in-flight action cannot be confirmed complete/cancelled, retain the queue and require an explicit retry; do not automatically replay the action. Stop/interrupt cannot undo an external action already taken. Existing tool approvals and subscription authentication remain unchanged. Provider errors are distinct from coordinator-requested interruption.

## Ownership, persistence, and recovery

`electron/tasks/coordinator.cjs` owns task state, scheduling, queues, provider sessions, and accumulated task-owned messages. `electron/tasks/notifications.cjs` owns native delivery. `electron/tasks/ipc.cjs` exposes validated commands to the trusted app window's main frame. Embedded webviews do not receive these capabilities. `src/shared/tasks.ts` defines the wire contract.

The renderer subscribes before fetching a snapshot, buffers live events during hydration, and merges the highest revision per task. Upsert only task-owned message IDs; never replace a chat's title, project, pin/archive, feedback, or unrelated history. A creation envelope lets an accepted new chat reappear after reload before its first renderer save. Completion snapshots survive the renderer's absence while the app process lives.

Existing history/media storage remains the durable source after process exit. Add task/attempt status and queued-message delivery metadata to saved messages. Convert chat saves to awaitable, coalescing writes: media first, metadata second. Checkpoint active output at 250 ms, flush terminal and accepted-message changes immediately, and acknowledge the task revision only after the save succeeds. Disk failures retain in-memory output and show an error. No guaranteed recovery of the last unflushed fragment or an acceptance during a renderer outage after a subsequent process crash.

After terminal acknowledgement, drop duplicated history/media/output from main and retain at most 100 summaries for the current app session. Explicit retry submits validated current chat context from the renderer with `retryOf`; it does not promise old frozen context remains after pruning. Active task context remains frozen.

Delete first awaits `forgetTarget`: fence its generation, cancel the task, remove snapshots/notifications, then remove local chat data. Undo restores saved content under a new generation, never resumes a task. Delete all chats uses the same ordering for every target. Edits/regeneration of settled history detach older acknowledged task projections before truncation so reload cannot restore removed replies. Archive/move/navigation do not cancel. Restart without a matching live coordinator task marks persisted pending/running messages interrupted; no automatic provider calls.

Temporary chats stop/discard when left. Side chats continue when hidden/switched but stop/discard when closed. Both remain ephemeral in Jarvis-owned storage and notifications. Renderer destruction cancels its ephemeral targets. This does not change retention in provider-owned systems such as Claude Code session files.

## Notifications and UI

Retain current neutral surfaces, accent `#57998a`, Geist typography, spacing, and existing toast behavior. No brand-assets folder exists. Add a compact **Tasks** button with active count and a keyboard-accessible popover: title, provider, state, Open, Stop. Chat/sidebar and side-tab entries show running/queued/unread status. Main and visible side panes both count as seen.

While running, composer Send becomes **Queue message**. Show a compact queued-message list above it and a separate **Interrupt & apply** action when the queue is nonempty. Keep **Stop** separate. Enter queues; Shift+Enter inserts a newline. Show **Interrupting…** while awaiting the provider, then **Applying queued messages…** until handoff. Use visible status text and accessible labels, not color alone. Disable edit/regenerate only on the active target.

Submission is asynchronous: capture draft revision, await acceptance, then consume only submitted content. Typing/attachments added while awaiting IPC remain. Errors and completion races keep drafts. Queued-file chips use existing attachment previews. Popovers support Escape/focus restoration, reduced motion, and desktop/narrow layouts.

Notify once on final completion/failure, never intermediate attempts or cancellation. If the target is visible in the focused app, use inline status and mark read. Otherwise record unread state and an in-app notice; when the app is unfocused, additionally attempt a native notification. Settings → General adds **Desktop task notifications**, default on, silent. Native copy is generic (**A task finished in Jarvis** / **A task needs attention in Jarvis**); content stays inside the app. Ephemeral targets use in-app notices only.

Notification click while the process exists focuses/recreates the window and routes to the exact task once the renderer is ready. Deleted targets open Tasks, never restore deleted content. Unsupported/failed native delivery retains in-app state. No native notification replay after restart and no cold-start notification routing guarantee. Current macOS Electron notifications require a signed application; validate the fallback in development. [Electron notifications](https://www.electronjs.org/docs/latest/api/notification).

## Verification and boundaries

Test A/B concurrency, main/side isolation, FIFO capacity/workspace lane, queue without abort, manual interruption, automatic queue continuation, queue removal, late events, duplicate commands, completion races, tool boundaries/unknown outcomes, Claude SIGINT/timeout/session resume, draft acceptance, media context, reload, deletion/undo/clear-all, temporary cleanup, notification focus/dedup/click/failure, and restart interruption without model calls.

Use controllable provider/subprocess fixtures and assert actual outgoing context. Exercise Electron main/preload integration as well as the browser bridge. Compare desktop dark/light and narrow screenshots in at least two localhost rounds using existing helpers. Preserve current uncommitted work; do not copy the old unused SQLite backend into the live path.

Not included: scheduling, cloud execution, post-quit workers, automatic crash replay, full storage migration, model swaps mid-task, or new billing/auth integrations. Baseline: 183 tests and production build pass; build retains its existing bundle-size advisory.

## Unresolved questions

None required for planning. Builder defaults: three concurrent attempts, one Claude code workspace lane, FIFO queueing, automatic continuation at normal completion, silent native alerts, app-process lifetime only.
