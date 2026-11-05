## Production gate: **NO-SHIP**

Audited `main` at `f20fe5372e10c44788dff30abb8909e2422521dc`. The application is a functional development prototype, but it does not meet a defensible production desktop release gate.

### Verification performed

- `npm test`: **318/318 passed** on a standalone rerun.
  - An earlier run under concurrent gate load timed out in the oversized-conversation test, indicating limited timing margin.
- `npm run build`: **passed**.
- `npm run typecheck:backend`: **passed**.
- `npm audit`: **failed** — 19 findings: **2 critical, 8 high, 8 moderate, 1 low**.
- `npm audit --omit=dev`: **failed** — 9 findings: **2 high, 6 moderate, 1 low**.
- `npm run test:ui` and `npm run test:media`: **could not run** because scripts contain a developer-specific macOS Chromium path.
- `npm pack --dry-run`: produced a source-oriented npm archive, not an installable Electron application.
- Confirmed no CI workflows, desktop packager, signing/notarization configuration, README, or license.
- Final Git state remained clean at the requested commit.

## Prioritized findings

### P0 — Release blockers

1. **No production packaging or release pipeline**
   - `package.json` has no `build:desktop`, `package:*`, installer, updater, signing, notarization, or artifact verification scripts.
   - No Electron Forge, Electron Builder, or Packager dependency/configuration exists.
   - There is no packaged-app validation for native `better-sqlite3`.
   - No CI configuration exists.
   - A passing Vite build only proves renderer assets, not a distributable desktop application.

2. **Provider distribution eligibility is unresolved**
   - Repository research explicitly says Google excludes third-party Antigravity consumer-plan wrappers and that Claude/Grok product scope remains unresolved (`docs/research/2026-10-21-subscription-model-switching.md:43-46`).
   - The repository also states authenticated provider replies still require live user-run acceptance (`docs/provider-connections.md:23-25`).
   - Do not treat account fixtures, quota parsers, mock OAuth, or saved plan labels as live subscription evidence.
   - Production distribution must exclude unresolved providers or obtain documented provider approval/use a permitted API route.

3. **Known vulnerable dependency tree**
   - Production-tree audit includes vulnerable `body-parser` and `lodash-es`, plus multiple vulnerable Mermaid/parser dependencies.
   - Full audit additionally reports critical Vitest/Tinypool issues and a high-severity Electron advisory.
   - Electron `44.6.0` is directly affected; the audit identifies a patched 44.x release.
   - Mermaid `11.6.0` has XSS, injection, prototype-pollution, and denial-of-service advisories relevant because assistant output is rendered as diagrams.

### P1 — Security and authorization blockers

4. **Privileged IPC trust checks are inconsistent**
   - Task and Gemini/Grok account IPC are protected by `isTrustedSender`.
   - ChatGPT auth/inference, Claude, tools, `save-file`, and `open-external` handlers lack the same sender/main-frame check:
     - `electron/chatgpt-auth.cjs:315-320`
     - `electron/chatgpt-inference.cjs:363-380`
     - `electron/claude-code.cjs:495-510`
     - `electron/tools/index.cjs:72-115`
     - `electron/main.cjs:111-136`
   - This weakens defense against renderer compromise and future preload/subframe changes.
   - `VITE_DEV_SERVER_URL` can also make the privileged application window load an environment-supplied URL (`electron/main.cjs:77-79`); production builds should fail closed instead.

5. **No Content Security Policy**
   - `index.html` defines no CSP.
   - This is especially concerning in an Electron renderer that displays provider-generated content and has a privileged preload bridge.
   - Context isolation and sandboxing are correctly enabled, but they do not replace CSP or uniform IPC authorization.

6. **Model tool calls execute without a user approval boundary**
   - ChatGPT executes model-selected MCP calls directly (`electron/chatgpt-inference.cjs:293-309`).
   - Imported MCP servers can provide externally consequential tools; no read-only classification, per-call consent, or explicit side-effect confirmation is enforced.
   - Prompt injection in chat, attachments, skill instructions, or tool output could therefore cause unintended external actions.

7. **Authenticated MCP endpoints may use plaintext HTTP**
   - Imported remote servers accept both `http:` and `https:` (`electron/tools/sources.cjs:67-76`).
   - Stored Authorization headers and OAuth credentials can subsequently be attached by the host.
   - Non-loopback HTTP must be rejected, and redirect behavior must be tested to ensure credentials never cross origins.

8. **Imported skill copying trusts symlinks and is unbounded**
   - Skill discovery accepts symbolic-link directories.
   - Import uses recursive copy with `dereference: true` (`electron/tools/store.cjs:79-85`).
   - A malicious or accidental symlink tree could copy unrelated local files into Jarvis’s skill store, where model-facing tools can enumerate/read them.
   - There are no aggregate byte, depth, file-count, special-file, or resolved-path containment limits.

9. **Long-lived credentials are plaintext files**
   - ChatGPT refresh/access/ID tokens and MCP OAuth data are stored in owner-only JSON files.
   - Mode `0600` is good baseline hygiene, but a production macOS application should use Keychain/Electron `safeStorage` for token material, with migration and failure tests.

### P2 — Quality and operational readiness

10. **Browser acceptance suites are not portable**
    - Multiple scripts hard-code `/Users/dereksu/.../Google Chrome for Testing`.
    - `check-chat-flows.mjs` does not provide an environment override.
    - Consequently, `npm run test:ui` and `npm run test:media` fail before executing tests on this Linux audit host.
    - These suites are also absent from the main verification script.

11. **No reproducible clean-checkout release gate**
    - `ralph:verify` runs unit tests, renderer build, and backend typecheck only.
    - Missing gates include `npm ci`, audit policy, browser tests, packaged Electron launch, native-module loading, migration tests, installer checks, and artifact checksums.

12. **Build performance warning**
    - The main renderer chunk is approximately 577 kB minified, and several Mermaid chunks are large.
    - Not a security blocker, but startup/memory performance should be measured in the packaged application.

## Recommended missing tests

1. **IPC authorization matrix:** invoke every privileged channel from foreign web contents, subframes, destroyed senders, webviews, and navigation-replaced frames; all must fail.
2. **Production navigation:** prove packaged builds cannot honor `VITE_DEV_SERVER_URL` or load remote content into the privileged renderer.
3. **CSP regression:** packaged renderer boots under a strict CSP; injected scripts, event handlers, remote scripts, and unsafe URLs are blocked.
4. **Tool consent and prompt injection:** malicious chat text, PDFs, skills, MCP outputs, and web content cannot trigger side-effecting calls without explicit user approval.
5. **MCP transport security:** reject credentialed non-loopback HTTP; ensure Authorization headers are stripped on cross-origin redirects.
6. **Skill import containment:** symlinks, cycles, FIFOs/devices, deep trees, huge files, and out-of-root targets must be rejected without copying external data.
7. **Credential storage:** Keychain/safe-storage migration, locked-keychain behavior, corruption, logout deletion, and file-permission tests.
8. **OAuth hardening:** callback path equality, duplicate callbacks, cancellation races, malformed discovery/JWKS, fetch timeouts, key rotation, and revocation failure.
9. **Dependency exploit regressions:** hostile Mermaid/KaTeX inputs, prototype-pollution payloads, and CPU/memory denial-of-service cases.
10. **Packaged Electron E2E:** launch signed artifact on a clean supported Mac; validate preload isolation, native SQLite loading, browser partitioning, OAuth callbacks, upgrade/migration, and uninstall/reinstall behavior.
11. **Recovery:** abrupt termination during writes, WAL recovery, disk-full behavior, migration rollback, backup/export/restore, and credential-preserving data recovery.
12. **Live acceptance:** owner-run authenticated sign-in and one real non-destructive response per supported provider. Record provider/version/account state separately; fixtures never satisfy this gate.

## Ship criteria

Ship only when all of the following are true:

- All P0/P1 findings are resolved or affected functionality is removed.
- Provider distribution rights are documented for every enabled subscription integration.
- `npm audit` has no unaccepted critical/high findings in anything shipped or used by release automation.
- A clean checkout passes install, tests, typechecks, browser acceptance, security tests, and production packaging in CI.
- CI actions and release dependencies are immutably pinned.
- A signed and notarized installer is launched successfully on a clean supported Mac, including native SQLite verification.
- Strict CSP and uniform trusted-sender checks protect every privileged IPC channel.
- Side-effecting model tools require explicit, auditable user approval.
- Live provider acceptance is completed and clearly distinguished from fixtures.
- Release artifact checksum, SBOM/dependency report, rollback procedure, and known limitations are recorded.

### Files

- **Created or modified:** none.
- Generated ignored build output was refreshed by `npm run build`; tracked working tree remained clean.
- **Issues encountered:** browser suites could not start because of hard-coded developer-specific Chromium paths.