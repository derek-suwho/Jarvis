# Production readiness baseline

Inspection: 2026-10-29. Baseline incomplete; this is a source inspection, not release acceptance or a current provider-policy verification.

## Verification evidence

- Runtime: Node 26.13.0, npm 11.20.0 in this workspace.
- `npm ci --cache .npm-cache --no-audit --no-fund`: blocked by registry DNS failures (`EAI_AGAIN` for registry.npmjs.org, including the locked Ralph CLI tarball); interrupted with exit 130 after repeated retries. Locked dependencies are not installed.
- `npm run ralph:verify`: exit 127, `vitest: not found`. Tests did not execute; build and backend typecheck were not reached.
- Configured acceptance command runs Vitest, renderer TypeScript/Vite build, and backend typecheck. Browser and Electron scripts (`test:ui`, `test:media`, other `scripts/check-*`) are separate and have not been run this iteration.
- No live accounts, credentials, provider prompts, signing, packaging, or installation checks were used.

## Architecture and specification findings

Read the MVP, background-task and media design specs, provider-connection notes, and representative runtime/storage/memory tests and source. The MVP describes main-process SQLite, bounded context, automatic shared memory and narrow validated IPC. Later background-task/media designs explicitly preserve localStorage chat metadata and IndexedDB media and defer full database migration.

The live path is React/Vite → preload bridge → Electron task coordinator → provider adapters. `electron/main.cjs` configures isolation, sandboxing and no renderer Node integration; it also enables embedded webviews. `electron/tasks` owns process-lifetime task state. `src/lib/chats.ts` and `mediaStore.ts` persist renderer data. SQLite/memory modules under `desktop/` have unit tests but are not connected through the production preload/main entry points. Backend test success alone would not prove automatic memory in the shipped app.

## Code-owned checklist (in TASKS.md order)

- [ ] Restore locked installation and establish current full verification results; retain failures rather than citing historical passing counts.
- [ ] Security: add regression tests for uniform trusted main-frame IPC checks. Main currently applies its trust wrapper to Gemini/Grok, while ChatGPT/Claude/tools register directly; open-external/save-file/theme also need review. Add restrictive CSP (absent from `index.html`), audit webview navigation/permissions and external URLs, and validate request sizes and shapes at every boundary.
- [ ] Privacy: audit app-owned token persistence (`chatgpt-auth.cjs` writes JSON with mode 0600), secret isolation, disconnect races, tool permissions, logs, local file permissions, exports, and model/attachment injection. File permissions alone do not establish encrypted credential storage.
- [ ] Continuity: verify four-provider outgoing bounded context and honest errors; cover switch/cancel/retry/disconnect/reload/restart races with deterministic fixtures. Current `buildReplyHistory` rejects over 200 messages/400,000 characters or 20 MB; it does not implement the MVP's model-dependent 24 KiB context assembly/compaction.
- [ ] Memory/storage: connect the tested backend to the real product with a migration/recovery plan preserving rich messages/media. Demonstrate automatic extraction and scoped retrieval through the production bridge, correction/conflict/forget/delete semantics, backup/export and malformed data. Prove at least 18/20 retrieval scenarios plus all deletion, contradiction and wrong-project negatives, per MVP spec.
- [ ] Desktop UX: verify onboarding/status, privacy and extra-usage disclosures, storage failures, offline/recovery states, keyboard/focus/accessibility, macOS sizes, background tasks and schedules. Preserve visual design; disclose process-lifetime task limits.
- [ ] Release engineering: add CI for the configured command, packaging metadata and reproducible artifacts; dependency/license inventory; update policy; credential-free signing/notarization instructions. Current package scripts build renderer assets but do not define a distributable packaging pipeline.
- [ ] Reliability: measure dependency vulnerabilities, renderer bundle size, startup/resources, sensitive logging and unused/placeholder paths after installation works.
- [ ] Final acceptance: record exact automated and packaged-product results, user/operator guidance and remaining external gates. Do not infer release readiness from source inspection.

## External evidence and decisions (separate release gates)

- [ ] Live account and entitlement acceptance for each supported provider: dated client/route versions, subscription-funded streaming, cancellation, quota/expiry and reauthentication evidence. Fixtures are not this evidence.
- [ ] Provider commercial eligibility for Jarvis's intended paid custom interface/distribution. Existing research/specs leave this unresolved; installed clients or successful authentication do not establish permission.
- [ ] Paid-launch commercial decisions and service setup: price, payment provider, offline entitlement policy; implement and test billing/entitlement behavior separately as code-owned work.
- [ ] Authorized macOS signing identity and notarization access, then actual signed/notarized artifact evidence. Configuration/documentation can be prepared without credentials.
- [ ] Clean-Mac installation and packaged-app acceptance on intended architecture(s), including native notifications and the defining cross-provider/restart memory demo; no such evidence collected here.

Next: make the locked npm registry artifacts available inside the permitted sandbox, rerun installation and `npm run ralph:verify`, then complete the baseline task before starting security fixes with one failing regression test at a time.
