## Audit outcome

- Audited the **live remote workspace** at `/home/coder/projects/building-team/jarvis-production-ready`; `/opt/data/Jarvis` was not used because it is stale relative to the active Ralph workspace.
- **No P0 release blocker identified** in this read-only pass.
- Found **five P1** and several P2 reliability/performance risks.
- The workspace was actively changing during the audit: roughly **156 modified/untracked paths**, with Ralph currently splitting KaTeX from the renderer entry bundle. Measurements below distinguish the last completed build from that in-progress work.

## P1 findings

1. **Desktop checkpoint design will reject realistic attachment histories and repeatedly rewrites the entire archive**
   - Files:
     - `src/App.tsx:184-205`
     - `src/lib/chats.ts:231-299`
     - `electron/checkpoints.cjs:1-35`
     - `desktop/storage/checkpoints.ts:29-55`
   - Desktop saves retain attachment `data`/`preview` strings in one JSON SQLite field, capped at 32 MiB. A 10 MiB attachment becomes about **13.33 MiB** in base64; three such attachments total **40 MiB**, exceeding the cap. Once the total archive crosses that boundary, later conversation saves fail until history is removed.
   - During streaming, the 250 ms timer can serialize, clone, IPC-transfer, parse, reserialize, and replace the complete archive up to **4 times/sec**. At the cap, that is a theoretical **128 MiB/sec / 7.5 GiB per minute** of payload processing and SQLite writes.
   - Reproduce:
     ```bash
     npm test -- tests/checkpoint-renderer.test.ts tests/tasks/checkpoints.test.ts
     ```
     Add a regression containing three persisted 10 MiB attachments across separate turns; the current IPC bound should reject it.
   - Fix direction: persist binary media separately in the main process, keep only metadata IDs in the checkpoint, and save incrementally or at terminal task boundaries.

2. **Browser tabs create an unbounded number of live Chromium renderers**
   - Files:
     - `src/App.tsx:561-566`
     - `src/components/TabPanel.tsx:118-160`
     - `src/components/ChromiumView.tsx:13-166`
   - `openTab` appends without a cap, while inactive tabs deliberately stay mounted. Every browser tab therefore keeps an Electron `<webview>` and renderer process alive while hidden. A user can exhaust RAM/process resources by opening tabs.
   - Reproduce by repeatedly invoking New Tab and observing:
     ```bash
     ps -o pid,ppid,rss,%mem,command -C electron
     ```
   - Add an explicit tab/webview budget and either evict, suspend, or unmount inactive browser views while preserving URL/history state.

3. **Renderer/build resource use remains material; the current optimization is unverified**
   - Last completed build evidence: `.ralph/logs/iteration-0318-tests.log:274-285`
   - Last completed bundle:
     - Assets: **7,077,878 bytes**
     - JavaScript: **5,792,256 bytes**
     - Entry chunk: **613.98 kB**
     - Mermaid core: **686.22 kB**
     - ELK: **1,479.05 kB**
     - Vite emitted the `>500 kB` warning; sequential build took **1m18s**.
   - Audit test run: **1,282 tests / 112 files**, 79.39 seconds, **680,720 KiB max RSS**.
   - Concurrent Vite builds reached approximately **1.35 GiB RSS each** and stalled/terminated under contention. `PROGRESS.md:11757-11759` records the in-progress KaTeX lazy split, but its production build exited 143, so no post-change bundle reduction is proven.
   - Reproduce sequentially, with no concurrent Ralph build:
     ```bash
     /usr/bin/time -v npm run build
     find dist/assets -type f -printf '%s %p\n' | sort -nr
     ```
   - Establish hard entry/deferred-chunk and build-RSS budgets. Continue lazy-loading KaTeX, Mermaid, and artifact renderers; do not merely increase `chunkSizeWarningLimit`.

4. **Critical/high development dependency vulnerabilities affect CI and build execution**
   - `npm audit`: **11 vulnerable packages** — 2 critical, 4 high, 5 moderate.
   - Key paths:
     - `vitest@3.2.7 → tinypool@1.1.1`: critical prototype-pollution/RCE advisories.
     - `@ralph-orchestrator/ralph-cli@2.10.1 → axios@1.13.2`, `form-data@4.0.4`, `minimatch@10.1.1`.
   - Production-only audit is clean:
     ```bash
     npm audit --omit=dev --json   # 0 vulnerabilities
     npm audit --json              # 11 total
     npm ls vitest tinypool @ralph-orchestrator/ralph-cli axios minimatch form-data
     ```
   - This is not a packaged runtime exposure, but it is a release-pipeline execution risk. Upgrade Vitest/tinypool first and isolate Ralph tooling from app dependencies if possible.

5. **Connected MCP clients lack an application shutdown path**
   - Files:
     - `electron/tools/host.cjs:74-138,208-251`
     - `electron/tools/index.cjs:10-23,118`
     - `electron/main.cjs:266-282`
   - The tool host retains connected stdio/HTTP clients in `live`. It can disconnect individual servers, but exports no `shutdown()`; `before-quit` closes storage, Gemini, and Grok only. Stdio MCP children and remote sessions therefore depend on process/pipe teardown rather than explicit lifecycle closure.
   - Add `host.shutdown()` to close all entries, export it through `tools`, include it in the bounded `before-quit` shutdown, and test that every client is closed exactly once.

## P2 findings

- **Synchronous startup work:** `electron/main.cjs:212-260` opens SQLite and runs migrations before creating the first window. `desktop/storage/migrations.ts:60-68` can rebuild the complete FTS index, while `desktop/runtime.ts:21-22` immediately resumes pending memory extraction. Large databases may delay first paint and begin provider work during startup.
- **Session-lifetime set leak:** `desktop/memory/queue.ts:23,110-128` retains every successfully deleted chat ID in `cancelledChats`; IDs are removed only on rollback via `resumeChat`.
- **Dead code:** `src/useReplyStream.ts` has no importer, and `src/lib/tabs.ts:132-138` (`mockSideReply`) is definition-only. Browser preview code remains intentional and should not be removed with these paths.
- **Maintainability concentration:** 17,556 source lines across 113 files, but 15 files exceed 300 lines and four exceed 500:
  - `src/App.tsx` — 1,086 lines
  - `desktop/storage/memory.ts` — 668
  - `electron/gemini-cli.cjs` — 611
  - `electron/claude-code.cjs` — 514
- **Stale operator documentation:** `docs/production-readiness.md:17` still says SQLite/memory are not connected to production, while `electron/main.cjs:212-247` now connects them.
- **Sensitive logging:** no application `console.log/error/warn` calls were found. Provider stderr is bounded and generally not exposed. This area appears reasonably hardened, though MCP connection errors still return truncated `err.message` to the renderer and should receive explicit token/URL redaction tests.

## Non-overlapping Ralph slices

1. **Checkpoint/media persistence slice**
   - Own: `src/App.tsx`, `src/lib/chats.ts`, `electron/checkpoints.cjs`, `desktop/storage/checkpoints.ts`, new media storage/migration tests.
   - Acceptance: three 10 MiB historical attachments remain saveable; streaming no longer rewrites the full archive every 250 ms.

2. **Browser resource-budget slice**
   - Own: `src/components/TabPanel.tsx`, `src/components/ChromiumView.tsx`, `src/lib/tabs.ts`, focused tab lifecycle tests.
   - Acceptance: bounded live webviews with deterministic suspend/restore behavior.

3. **Bundle-budget slice**
   - Own: `src/components/Markdown.tsx`, `src/components/TeX.tsx`, `src/components/Artifact.tsx`, `vite.config.ts`, bundle tests/scripts.
   - Continue after the active KaTeX iteration. Acceptance must include a completed sequential build with recorded entry/deferred sizes and RSS.

4. **Dependency hygiene slice**
   - Own: `package.json`, `package-lock.json`, CI/audit configuration.
   - Acceptance: zero critical/high development advisories or documented isolated exceptions; full tests/build/typecheck pass.

5. **Tool shutdown slice**
   - Own: `electron/tools/host.cjs`, `electron/tools/index.cjs`, `electron/main.cjs`, tool lifecycle tests.
   - Acceptance: all MCP clients close once on quit within the existing deadline.

6. **Cleanup/documentation slice**
   - Own: dead renderer files/functions, `docs/production-readiness.md`, and small module extraction from monoliths.
   - Keep this last so it does not conflict with behavioral slices.

## Verification and workspace impact

- `npm test`: **1,282/1,282 passed**.
- `npm exec tsc -- --noEmit`: passed; 18.27 seconds, **630,156 KiB max RSS**.
- No repository files were created or modified by the audit.
- One temporary audit Vite build was stopped and cleaned up after it stalled alongside Ralph’s concurrent build. The repository remains an active moving target, so Ralph should remeasure bundle/status after the current iteration completes.

[NOTE: subagent modified files the parent previously read — re-read before editing: /opt/data/building-team/scripts/ralph_monitor.py]