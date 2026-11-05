## Production-readiness verdict

**Not production-ready.** Commit `f20fe53` is a credible, well-tested desktop prototype, but should not be distributed or marketed as the shared-memory product yet. The largest blockers are missing runtime memory integration, incomplete privacy/security controls, unresolved provider distribution eligibility, and no packaging/signing evidence.

## Highest-impact findings

### P0 — Release blockers

1. **The defining shared-memory experience is not wired into the product.**
   - Memory/storage logic exists under `desktop/storage/memory.ts` and `desktop/memory/`, but `electron/main.cjs`, `electron/preload.cjs`, and `src/App.tsx` do not expose or consume it.
   - There is no `MemoryPanel`, inspectable shared-context indicator, retrieval path, correction/forget UI, or demonstrated ChatGPT → Claude fresh-chat recall.
   - The live UI still stores chats/projects in browser storage through `src/lib/chats.ts` and `src/lib/projects.ts`.

2. **Privacy copy is materially incomplete.**
   - `SettingsDialog.tsx:48` says **“Everything is stored on this device only,”** without explaining that prompts, attachments, history, project instructions, and possibly tool context are transmitted to the selected provider.
   - “Delete all chats” only clears chats/drafts. It does not represent deletion of projects, schedules, preferences, tools, provider credentials, or provider-side copies.
   - “Export all” exports chat JSON only—not projects, instructions, schedules, memory, tool configuration, or persisted attachment bytes.
   - Temporary-chat copy explains local retention but not provider transmission.

3. **ChatGPT OAuth credentials are stored as plaintext JSON.**
   - `electron/chatgpt-auth.cjs:207-223` persists access, refresh, and ID tokens in `credentials.json` with mode `0600`.
   - This conflicts with the product spec’s `safeStorage`/Keychain requirement. OS permissions are valuable but are not application-level encryption.

4. **The Electron app has no restrictive application CSP.**
   - `index.html` contains no CSP, `vite.config.ts` defines none, and `loadFile()` adds no response headers.
   - This is especially important because model-generated Markdown, Mermaid/HTML artifacts, remote links, and embedded browsing are supported.
   - Sender validation is also inconsistent: task and Gemini/Grok IPC paths validate trusted senders, while ChatGPT/Claude/tools handlers are registered directly.

5. **No distributable desktop release pipeline exists.**
   - No Electron Builder configuration, package command, signing/notarization configuration, clean-machine installer test, update strategy, or packaged native-module verification.
   - The product specification explicitly requires packaged macOS acceptance and signing/notarization before an external pilot.

6. **Commercial provider eligibility remains unresolved.**
   - The product specs explicitly distinguish “works locally” from “permitted paid distribution.”
   - ChatGPT, Claude, Gemini, and Grok subscription access must each have dated evidence for entitlement, supported use, and commercial distribution before being represented as production-supported.

7. **Dependency audit fails.**
   - `npm audit --omit=dev`: **9 vulnerabilities**, including **2 high**.
   - Notable runtime-chain findings include KaTeX trust-bypass/prototype-pollution exposure and Mermaid/Lodash dependencies.

### P1 — UX and accessibility

- **No automated accessibility gate:** no axe, Accessibility Insights, or equivalent CI coverage.
- **Tab semantics are incomplete:** `TabPanel.tsx` makes every tab `tabIndex={0}` and lacks standard Left/Right/Home/End tablist navigation and associated `tabpanel` semantics.
- **Toggle state is visual-only:** message feedback/read-aloud buttons receive a `pressed` CSS class but no `aria-pressed`.
- **Resize separators omit value semantics:** `ResizeHandle.tsx` lacks `aria-valuenow`, `aria-valuemin`, and `aria-valuemax`.
- **Model-picker popover is a dialog without modal focus containment:** keyboard focus can leave the popover rather than cycling predictably.
- **Some icon-only controls rely on `title` rather than explicit labels**, including tab-panel controls.
- **Very small persistent helper text:** composer footer is `10.5px`; contrast checks passed for the primary muted tokens, but readability/zoom testing is still required.
- **Scheduled-task trust:** scheduling uses whichever model is selected at run time, with no per-schedule provider/model identity or pre-run data-sharing summary. Production behavior should be explicit and stable.

### Existing strengths

- Good draft preservation and send-failure handling.
- Attachments are validated for count, size, signatures, UTF-8, and aggregate request limits.
- Dialog focus trapping/restoration is implemented.
- Visible focus, reduced motion, responsive sidebar behavior, keyboard search, errors, Stop, retry, task queue, and partial-response states are thoughtfully handled.
- Electron enables sandboxing, context isolation, disabled Node integration, and navigation/window restrictions.

## Production acceptance criteria

Release only when all applicable criteria pass with recorded evidence:

1. **Defining demo:** ChatGPT learns a fact/decision → switch to Claude → restart → fresh chat recalls it; two projects remain correctly scoped; corrections, conflicts, forget, and source deletion pass.
2. **Truthful provider behavior:** no simulated “preview” reply can be mistaken for live inference; every selectable model has connected-state and entitlement evidence; auth/quota/network failures preserve the draft and offer recovery.
3. **Privacy:** concise onboarding and settings disclosures identify local data, provider transmission, tool/MCP transmission, temporary-chat limits, credential storage, deletion boundaries, and absence/presence of telemetry.
4. **Data controls:** versioned export and deletion cover chats, projects, instructions, schedules, memory, attachments, and drafts; clearly separate local deletion from provider retention and credential revocation.
5. **Credential/security:** ChatGPT tokens use Electron `safeStorage`/Keychain and fail closed when encryption is unavailable; every IPC handler validates sender/frame and input; restrictive CSP is enforced in packaged output.
6. **Accessibility:** WCAG 2.2 AA keyboard walkthrough passes; axe has no serious/critical findings; dialogs/popovers trap and restore focus; tablists, toggles, separators, live states, zoom, contrast, and reduced motion are verified.
7. **Desktop reliability:** crash/restart, interrupted streaming, concurrent chats, task deletion, scheduled runs, save failure, expired auth, quota, offline operation, and provider disconnect have deterministic acceptance tests.
8. **Packaging:** reproducible signed/notarized macOS package; installer tested on a clean supported Mac; `better-sqlite3`, auth callbacks, attachment storage, CSP, and updates verified in the packaged app.
9. **Commercial gate:** written evidence establishes paid-distribution eligibility for every provider advertised as supported.
10. **Quality/supply chain:** unit/type checks, UI/Electron E2E, dependency audit, accessibility scan, console/network checks, and light/dark/minimum-window visual regression all pass.

## Safe product/design worktree ownership

### Safe exclusive ownership

- **Conversation/composer**
  - `src/components/ChatView.tsx`, `ChatView.css`
  - `src/components/Composer.tsx`, `Composer.css`
  - `src/components/MessageItem.tsx`, `Messages.css`
  - `src/components/Markdown.tsx`
- **Navigation and shell**
  - `src/components/NavigationRail.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/Shell.css`
- **Dialogs/settings**
  - `src/components/SettingsDialog.tsx`, `SettingsDialog.css`
  - `src/components/SearchDialog.tsx`
  - `src/components/RenameDialog.tsx`
  - `src/components/Dialogs.css`
  - `src/components/useDialog.ts`
- **Scheduled-task presentation**
  - `src/components/ScheduledView.tsx`
  - `src/components/Scheduled.css`
- **Component-local presentation**
  - `ModelPicker.tsx/.css`, `TabPanel.tsx/.css`, `ToolsPanel.tsx/.css`, `Artifact.tsx/.css`

### Shared/high-conflict files—coordinate before editing

- `src/App.tsx`: central integration and merge hotspot.
- `src/styles.css`: global tokens, focus rules, and legacy layout selectors.
- `src/components/Icons.tsx`: shared by almost every component.
- `src/lib/models.ts`, `preferences.ts`, `projects.ts`, `schedules.ts`, `tabs.ts`: shared state contracts.

### Out of bounds for a product/design-only worktree

- `electron/**`
- `desktop/**`
- `src/shared/**`
- `src/lib/providerClient.ts`, `replyContext.ts`, `tasks.ts`, `taskProjection.ts`, `chats.ts`, `drafts.ts`, `attachments.ts`, `mediaStore.ts`
- Tests governing provider, storage, task, memory, and security behavior

Keep component prop contracts stable; route new state or behavior through a coordinated integration change rather than importing Electron/provider code into presentation components.

## Verification and workspace status

- Confirmed exact commit and branch: `main` at `f20fe5372e10c44788dff30abb8909e2422521dc`.
- `npm test`: **35 files, 318 tests passed**.
- Renderer TypeScript check: **passed**.
- Backend TypeScript check: **passed**.
- `npm audit --omit=dev`: **failed with 9 vulnerabilities**.
- Browser visual execution was blocked because the remote browser cannot access localhost and the repository’s Puppeteer configuration references a missing macOS Chrome binary.
- **Files modified:** none.
- A test-generated untracked `core` artifact was removed; final `git status` was clean.