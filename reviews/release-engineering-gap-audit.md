## Release-engineering audit outcome: **NO-SHIP**

Audited the live remote workspace at `/home/coder/projects/building-team/jarvis-production-ready`, HEAD `b5b213f2bf0a5875e6e1a1722003245ea3f04016`. The workspace was actively being written by Ralph and had 156 dirty/untracked entries; this was a read-only point-in-time audit.

### What exists

- `scripts/release-manifest.mjs` and `tests/release-manifest.test.ts` provide sorted SHA-256 artifact checksums and reject symlinks.
- Current production dependency audit is clean: `npm audit --omit=dev` reported **0 vulnerabilities**.
- Existing trusted evidence reports 111 test files / 1281 tests, renderer/backend builds, backend typecheck, and a native Electron/SQLite relaunch gate passing outside the nested sandbox.
- Release engineering remains unchecked in `TASKS.md`.

## Prioritized code-owned checklist

### P0 — Add an actual Electron packaging pipeline

**Current gap:** `package.json` has no `package:mac`, packager, native rebuild, or packaged-app test. There is no Electron Builder/Forge configuration, macOS icon, entitlements, or release directory.

**Files:**

- Modify `package.json`, `package-lock.json`, `.gitignore`
- Add `electron-builder.yml` or a `build` block in `package.json`
- Add `build/icon.icns`
- Add `build/entitlements.mac.plist`
- Add `scripts/check-packaged-app.mjs`
- Add `tests/packaging-config.test.ts`

Configuration must define:

- Stable `appId`, `productName`, version, category, minimum macOS, architectures and artifact names
- Explicit file allowlist including `electron/**`, `dist/**`, and required production dependencies
- `asar` policy and native `better-sqlite3` unpack/rebuild handling
- DMG plus ZIP targets
- No implicit publishing or updater endpoint
- Separate unsigned CI packaging from signed release packaging

**Missing tests:**

- Package contains `dist/backend/storage.cjs`, preload, main process, and renderer assets
- Package excludes `.env*`, `.runtime`, tests, docs, caches, Ralph state/logs and source-only tooling
- Packaged app launches with isolated temporary `userData`
- Packaged `better-sqlite3` opens, writes, closes and reopens
- Artifact names are stable by version/architecture
- Package fails if required metadata, icon, native module or backend output is absent

### P0 — Add CI and macOS release workflows

**Current gap:** `.github/` does not exist; no clean-checkout verification is automated.

**Files:**

- Add `.github/workflows/ci.yml`
- Add `.github/workflows/release-macos.yml`
- Add `.nvmrc`
- Modify `package.json` with `engines` and `packageManager`

Requirements:

- Pin every GitHub Action to an immutable commit SHA
- Use `npm ci`, never mutable dependency installation
- Run tests/build/backend typecheck sequentially to avoid the observed five-second heavy-test contention
- Run browser checks portably
- Run unsigned package/native smoke on macOS
- Put signing/notarization behind a protected release environment
- Give jobs minimum permissions; do not expose secrets to PR jobs
- Upload checksums, dependency/license report and packaged artifacts together

### P0 — Document and configure signing/notarization without credentials

**Current gap:** no signing/notarization configuration or instructions exist.

**Files:**

- Add `docs/releasing-macos.md`
- Add `build/entitlements.mac.plist`
- Add hardened-runtime options to packaging config
- Add `scripts/verify-macos-artifact.sh` or equivalent cross-platform Node script

The documentation must cover certificate selection, hardened runtime, entitlements, notarization submission, stapling, Gatekeeper validation, rollback and secret names—but contain no certificate, Apple ID, team secret or notarization credential.

**Missing tests/checks:**

- Entitlements/config lint
- Unsigned PR package clearly identified as non-distributable
- Release workflow refuses to publish an unsigned or unstapled artifact
- Artifact is verified with `codesign`, `spctl` and `stapler`

### P1 — Complete deterministic artifact handling

**Current state:** `scripts/release-manifest.mjs` is useful but unintegrated and does not prove packaging reproducibility or provenance.

**Files:**

- Modify `scripts/release-manifest.mjs`
- Expand `tests/release-manifest.test.ts`
- Add `scripts/release-provenance.mjs`
- Wire scripts into `package.json` and release workflow

Add:

- Fail if the input root is a file rather than a directory
- Fail on an empty artifact directory
- Tests for newline/backslash names, special files/FIFOs and missing directories
- Version, architecture, Git revision, Node/npm/Electron versions and build mode in a provenance document
- Clean-worktree/tag/version agreement check for releases
- Stable artifact naming and explicit placement of the manifest outside the hashed directory
- Two clean unsigned builds compared for expected reproducibility; document any unavoidable timestamp/signature variance rather than claiming bit-for-bit identity

Also ignore `.npm-cache/`, packaging output and temporary release-test directories in `.gitignore`; `.npm-cache/` is currently a large untracked workspace contaminant.

### P1 — Establish dependency and license gates

**Current evidence:**

- Production audit: **0 vulnerabilities**
- Full audit: **11 vulnerabilities** — 2 critical, 4 high, 5 moderate
- Critical findings are in Vitest/Tinypool; Ralph CLI has direct moderate advisories
- Lockfile contains 480 package entries
- Production licenses include OFL-1.1 fonts, Apache/MPL dual-licensed DOMPurify and EPL-2.0 `elkjs`
- `khroma@2.1.0` has no license metadata in its package
- No root `LICENSE`, NOTICE, dependency inventory or policy exists

**Files:**

- Add `scripts/license-report.mjs`
- Add `config/allowed-licenses.json`
- Add `THIRD_PARTY_NOTICES.md`
- Add the intended application `LICENSE`/EULA
- Add `tests/license-report.test.ts`
- Modify CI to run production audit and license policy

The gate should walk the production lockfile, preserve dependency/version/license/source, fail unknown/disallowed licenses, and require an explicit disposition for `khroma`. Dev-only critical/high advisories must be fixed or recorded as accepted release-tooling risk; they should not be silently ignored because compromised test/release tooling can affect artifacts.

### P1 — Make the update strategy explicit

**Current gap:** no `electron-updater`, update feed, rollback policy or explicit deferral document.

**Files:**

- Add `docs/update-policy.md`
- Add `tests/update-policy.test.ts` or packaging-policy assertions
- Modify packaging config to set publishing behavior explicitly

Safest initial policy is an explicit manual-update deferral:

- No automatic download/install
- No implicit publish target or update metadata
- Document version discovery, download source, rollback, migration compatibility and security-response expectations

If automatic updates are later selected, treat that as a separate signed-feed workstream with signature, downgrade, failed-download, staged rollout and rollback tests.

### P2 — Complete release metadata and operator documentation

`package.json` lacks description, author, license, homepage, repository, engines, package manager and packaging metadata. The repository also lacks `README.md` and `CHANGELOG.md`.

**Files:**

- Modify `package.json`
- Add `README.md`, `CHANGELOG.md`
- Update `docs/production-readiness.md`; its installation evidence is stale
- Add `docs/release-candidate-template.md`

The release-candidate report should record exact commands/results, artifact hashes, architecture, dependency/license state, known limitations and external gates.

## Acceptance commands

These should be supported and pass from a clean checkout after implementation:

```bash
npm ci --no-audit --no-fund
npm audit --omit=dev
npm run release:licenses
npm run ralph:verify
npm run test:ui
npm run test:media
npm run package:mac
npm run test:packaged
npm run release:manifest -- release
npm run release:provenance -- release
git diff --check
```

On the macOS release artifact:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac*/Jarvis.app"
spctl --assess --type execute --verbose=4 "release/mac*/Jarvis.app"
xcrun stapler validate "release/Jarvis-<version>-<arch>.dmg"
```

A second clean unsigned package build should produce the same expected file set, artifact names and checksum/provenance structure; any byte differences must be explained.

## External gates — not code completion

- Apple Developer Program membership and authorized Developer ID Application identity
- Actual signing and Apple notarization credentials
- Successful notarization/stapling and Gatekeeper assessment
- Clean supported-Mac installation on each intended architecture
- Live authentication, streaming, cancellation, expiry/quota and reauthentication for each provider
- Written commercial/distribution eligibility for every enabled provider route
- Legal approval of the app license/EULA and unresolved third-party license disposition

Fixture tests, unsigned packages and successful local CLI authentication do not satisfy these gates.

## Audit summary

- **Did:** Inspected the live remote package/scripts/workflows/config/docs, release-manifest implementation, lockfile licenses, vulnerability state and Ralph progress.
- **Found:** Checksum groundwork exists and production dependencies currently audit clean, but CI, packaging, native packaged-app verification, signing docs, updater policy and license governance are absent.
- **Files created or modified:** None.
- **Issues:** Workspace was live and dirty during inspection; findings are a point-in-time snapshot. No credentials were read or used beyond the preconfigured SSH invocation.

[NOTE: subagent modified files the parent previously read — re-read before editing: /opt/data/building-team/scripts/ralph_monitor.py]