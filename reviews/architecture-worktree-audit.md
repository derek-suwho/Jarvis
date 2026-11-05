## Outcome

- Inspected `/opt/data/Jarvis` at the required commit `f20fe5372e10c44788dff30abb8909e2422521dc`.
- Repository remained clean; **no files or worktrees were created or modified**.
- Verification:
  - `npm test`: **318/318 tests passed**
  - `npm run build`: **passed**, with a 576.82 kB main-chunk warning
  - `npm run typecheck:backend`: **passed**
  - `npm audit --omit=dev`: **failed — 9 vulnerabilities**, including 2 high
  - Browser/Electron checks could not run here because scripts hard-code a developer-specific macOS Chrome path and Electron’s Linux sandbox helper lacks required ownership/mode.

## Architecture assessment

The principal risk is that Jarvis currently contains **two disconnected architectures**:

1. The shipping Electron/React path uses:
   - `electron/*.cjs`
   - renderer-owned `localStorage`/IndexedDB
   - in-memory task coordination
   - direct provider bridges
   - preview/mock fallbacks

2. A well-tested but headless durable backend exists under:
   - `desktop/storage/**`
   - `desktop/memory/**`
   - `desktop/providers/types.ts`
   - `src/shared/{contracts,domain}.ts`

No `desktop/backend.ts`, `desktop/ipc.ts`, `desktop/chat/{orchestrator,context}.ts`, or `desktop/memory/retrieve.ts` exists, and none of the durable backend is composed into `electron/main.cjs`. Passing backend tests therefore does not prove that the product uses SQLite or shared memory.

Additional risks:

- `src/App.tsx` and `electron/main.cjs` are integration hotspots and should each have one owner.
- Renderer and backend have separate chat/run/task models, increasing semantic drift.
- `src/lib/models.ts`, `src/useReplyStream.ts`, `src/lib/previewTasks.ts`, and `src/lib/chats.ts` retain placeholder production behavior.
- No app-level CSP is present in `index.html`.
- Main-process IPC validation is inconsistent; several privileged account/tool handlers lack trusted-sender checks.
- ChatGPT refresh/access tokens are stored as plaintext JSON with mode `0600`, rather than Keychain-backed `safeStorage`.
- No packaging, native-ABI, updater, signing, or notarization configuration exists.
- UI test scripts are non-portable because they embed one developer’s macOS browser path.

## Top five code-owned production blockers

1. **Durable backend is not connected to the app**
   - Implement backend composition, orchestration, retrieval/context assembly, and validated IPC.
   - Current SQLite/memory code is test-only from the product’s perspective.

2. **Shipping renderer still owns persistence and mock behavior**
   - Replace `localStorage`/IndexedDB chat authority, placeholder model catalog, preview provider, and `mockReply` fallback with bridge-backed state.
   - Provide a validated, idempotent migration from existing renderer data.

3. **Security boundary is not production-ready**
   - Encrypt app-owned ChatGPT credentials with Electron `safeStorage`.
   - Apply trusted-main-frame checks to ChatGPT, Claude, tools, file-save, theme, and external-navigation IPC.
   - Add CSP and narrow or remove `webviewTag`/tool execution exposure.

4. **No distributable desktop release pipeline**
   - Missing Electron packaging configuration/scripts, native `better-sqlite3` ABI verification, packaged-app acceptance, clean-Mac installer testing, and portable browser/Electron tests.

5. **Paid-product entitlement is absent**
   - No hosted checkout, server-verified entitlement, cancellation/expiry handling, offline policy, or local-data export boundary exists.
   - This implementation is code-owned, although provider/payment decisions are external prerequisites.

## Conflict-free worktree map

Reserve `/opt/data/Jarvis` for the existing Ralph loop. Create sibling worktrees from `f20fe53`; never let two lanes own the same file.

| Worktree / branch | Exclusive ownership | Must not edit |
|---|---|---|
| `/opt/data/Jarvis-wt-core` / `arch/core-backend` | `desktop/**`, `src/shared/contracts.ts`, `src/shared/domain.ts`, `tests/storage/**`, `tests/memory/**`, new `tests/chat/**`, `tests/backend*` | `electron/**`, renderer files, package manifests |
| `/opt/data/Jarvis-wt-security` / `arch/provider-security` | `electron/chatgpt-*.cjs`, `electron/claude-code.cjs`, `electron/gemini-cli.cjs`, `electron/grok-cli.cjs`, `electron/subscription-stream.cjs`, `electron/tools/**`, corresponding provider/tool tests | `electron/main.cjs`, `electron/preload.cjs`, `src/**`, manifests |
| `/opt/data/Jarvis-wt-runtime` / `arch/runtime-bridge` | `electron/main.cjs`, `electron/preload.cjs`, `electron/tasks/**`, task/bridge integration tests | Provider implementations, renderer, manifests |
| `/opt/data/Jarvis-wt-renderer` / `arch/renderer-cutover` | `src/**` except `src/shared/**`; renderer/UI tests | `desktop/**`, `electron/**`, manifests |
| `/opt/data/Jarvis-wt-billing` / `arch/licensing` | New `desktop/licensing/**`, new hosted service directory, `src/components/SubscriptionPanel.*`, paid-launch design/acceptance docs | `src/App.tsx`, `electron/main.cjs`, manifests |
| `/opt/data/Jarvis-wt-release` / `arch/release` | `package.json`, `package-lock.json`, `.gitignore`, build/package configs, `scripts/**`, release/testing docs | Product implementation files |

**Hotspot rule:** only the named owner edits `electron/main.cjs`, `electron/preload.cjs`, `src/App.tsx`, or package manifests. Other lanes expose functions/components and provide a short integration note rather than editing a hotspot.

## Dependency and integration order

1. **Freeze shared contracts** in `arch/core-backend`.
2. Run **core backend** and **provider security** in parallel.
3. Integrate core, then security; rerun unit tests and both typechecks.
4. Build **runtime bridge** against the finalized backend and hardened provider signatures.
5. Build **renderer cutover** against the finalized preload contract; remove production mocks only after bridge-backed paths work.
6. Integrate **licensing** after core chat/memory behavior is stable.
7. Integrate **release** last because it exclusively owns manifests, lockfile, packaging, and cross-lane verification.
8. Final gate: full tests, backend typecheck, production build, packaged macOS launch, native SQLite reopen, live two-provider handoff/memory acceptance, then signing/notarization.

## External gates — do not report as code completion

- **Live accounts:** authenticated ChatGPT and Claude streaming, cancellation, reauthentication, quota behavior, and A→B→A handoff using customer-owned subscriptions.
- **Commercial permission:** explicit confirmation that both provider routes permit Jarvis’s paid distribution. A technically successful login does not establish this.
- **Signing/distribution:** Apple Developer identity, signing certificates, notarization credentials, and clean supported-Mac installer acceptance.
- **Commercial/billing decisions:** payment provider account, price, tax/legal setup, and offline entitlement policy.
- **Provider runtime availability:** supported official CLI/client versions installed where required.

No source files were changed.