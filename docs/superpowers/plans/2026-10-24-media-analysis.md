# PDF and Image Analysis Implementation Plan

**Goal:** Analyze attached PDFs/images through both existing subscription providers.
**Architecture:** Original base64 media accompanies existing text messages. IndexedDB stores binary payloads; adapters create native provider blocks.
**Stack:** React, TypeScript, Electron, IndexedDB, Vitest, Puppeteer.
**Spec:** ../specs/2026-10-24-media-analysis-design.md

## Constraints

Preserve dirty worktree. No separate API billing, external OCR, or UI redesign. Ten files/message; image 3 MiB, PDF 10 MiB, text 128 KiB; message aggregate 10 MiB; request 20 MiB; 200 messages/400,000 text characters. Temporary media never persisted.

## Tasks

- [x] Add failing media ingestion/history tests; implement format validation, base64 data, previews, and full-request preflight.
- [x] Add failing provider tests; implement strict media IPC validation, Responses blocks, and Claude stream-json replay/resume.
- [x] Implement IndexedDB media persistence with metadata-only localStorage, reload hydration, cleanup, and visible errors; verify browser lifecycle.
- [x] Update composer labels/thumbnails. Verify picker, paste/drop, mixed attachments, attachment-only sends, follow-ups, and rejected drafts in browser.
- [x] Run tests/build/backend checks; review diff and perform two localhost screenshot passes.

## Review focus

Corrupt/mislabeled media; request amplification/base64 limits; old media on model/session changes; storage quota/reload/temporary chats; overlapping reads and failed sends retaining drafts.

Unresolved questions: none.

## Verification

183 Vitest tests passed. Production build and backend typecheck passed; Vite retains its large-chunk warning. Navigation, chat-flow, stream-flow, media-flow, and real IndexedDB persistence scripts passed. Screenshot passes inspected desktop previews, restored history, and mobile layout. Independent review found one legacy image/jpg migration issue; fixed and verified through two reloads. Live provider inference was not exercised; native payloads and transport boundaries were tested with simulated responses. Run media checks with `npm run test:media` against `node serve.mjs` on localhost:3000.

## Runtime correction

The user's screenshot exposed a verification gap: the running Electron main process started at 23:44, before the media adapter update at 23:46. Vite refreshed the renderer but left the old main-process validator loaded; that validator silently discarded `media`. Browser tests replaced the bridge and therefore missed the mismatch.

- [x] Add isolated real Electron renderer/preload/IPC regression capturing the outgoing Responses payload.
- [x] Restart Electron on backend/preload changes while preserving the Vite server and origin; nine process-lifecycle tests pass.
- [x] Relaunch the user's app and verify live image/PDF inference through the production provider adapter.

Live verification (2026-10-25): GPT-5.6-Sol identified generated red/green squares and extracted `MEDIA_CHECK_92841` from a valid PDF. Neither answer appeared in the prompt or filenames. The exact response was `Red, green; MEDIA_CHECK_92841`. The user's existing conversation remains intact; native UI automation could inspect the window but failed to activate its controls, so the original reply was not regenerated.

Focused verification: 53 tests passed across media ingestion, history, validation, both provider adapters, and desktop lifecycle. Browser media flows and IndexedDB lifecycle checks passed. Persistence tests now await the updated asynchronous save API and explicitly assert expected quota/disk rejections.

The Electron regression now submits both files through the mounted composer, current task client, real preload/IPC, coordinator, and production Responses serializer. It asserts original bytes, completed task state, rendered reply, and no renderer/preload errors. The updated harness passed after the concurrent task-flow migration.

Current production build is blocked by concurrent background-task test type errors in `tests/tasks/chatgpt-session.test.ts` (inferred `never[]` updates, undeclared `attemptId`, optional continuation). These were outside the runtime-reload correction.

Unresolved questions: none.
