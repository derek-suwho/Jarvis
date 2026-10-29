# Desktop polish implementation plan

**Goal:** Complete and refine Jarvis's daily desktop chat flows.

**Architecture:** Existing React/Electron app; focused components and hooks. Keep local storage contracts compatible. No redesign of provider authentication.

**Spec:** `docs/superpowers/specs/2026-10-22-desktop-polish-design.md`

- [x] Research official Claude/ChatGPT flows and record evidence/limitations.
- [x] Navigation/dialogs: semantic rows, keyboard menus/search, focus management, shortcut reference.
- [x] Composer: draft isolation, two-row layout, usable text attachment transport and clear errors.
- [x] Shell/conversation/projects: visual hierarchy, responsive drawer, provider context, undo, rename and stream lifecycle.
- [x] Build/unit verification; localhost interaction checks and two screenshot review rounds.

Review focus: drafts crossing conversations; unsupported files; temporary persistence; navigation during generation; dialogs/menu focus and narrow-screen overflow.

Unresolved questions: none.

## Verification results

- `npm run build`: passed.
- `npm test`: 148 tests across 18 files passed.
- `npm run typecheck:backend`: passed.
- `npm run test:ui`: navigation, chat, and simulated-stream suites passed, including deletion undo, edit/retry, temporary draft cleanup, scoped instructions and payload limits.
- `git diff --check`: passed.
- Localhost baseline + two screenshot comparison rounds; desktop 1440×900 and narrow 390×844, both themes. Composer footer consolidated; mobile suggestion heights aligned; portal menus stay within viewport. Screenshots in ignored `temporary screenshots/`.
- `node serve.mjs` serves the preview on localhost:3000; start before UI suites. `node screenshot.mjs http://localhost:3000 label` captures a numbered screenshot.

Limits: official-source competitor research, not native authenticated walkthroughs. Stream tests use isolated simulated transports, not paid provider calls. This pass supports UTF-8 text/code attachments (10 files, 128 KB/file, 256 KB total) and preflights complete provider payloads. Image/PDF analysis and native Work/Cowork capability parity remain separate integration work.
