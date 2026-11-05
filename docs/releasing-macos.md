# macOS release verification

Release engineering is incomplete. Prepared dependencies now include pinned Electron Builder tooling. On a prepared macOS host, `npm run package:mac:unsigned` builds the app and requests unsigned arm64/x64 DMG and ZIP engineering artifacts under `release/`, with publishing disabled. The configuration enables native dependency rebuild and unpacks SQLite from asar. A preflight hook validates package name, release version and Electron entry point, then rejects missing or empty main/preload, renderer HTML, or compiled backend files before packaging begins. This checks build inputs; it does not validate the final archive or native ABI. Packaged launch and SQLite reopen acceptance on each architecture remain pending; this command has not been validated on macOS. Do not run dependency installation inside the Ralph workspace.

Unsigned CI artifacts are for testing only and must not be distributed as release candidates. Signing, notarization and clean-Mac acceptance have not been demonstrated.

## Protected signing stage requirements

Use a clean version-tagged checkout and a protected release environment. The release owner must supply an authorized Developer ID Application identity through an external credential store; no certificates, private keys, Apple account identifiers or notarization credentials belong in this repository. Keep signing secrets unavailable to pull-request jobs.

The future packaging configuration must enable hardened runtime and define reviewed Electron entitlements. Do not disable library validation or add unrestricted entitlements merely to make launch pass. Sign the app and disk image, submit through Apple's notarization tooling, and staple accepted tickets to the final app and DMG. Exact packaging, entitlement and submission commands remain pending implementation and validation on macOS.

## Final artifact gate

Run on macOS, against the final app and its final nonempty disk image:

```sh
node scripts/verify-macos-artifact.mjs '/path/to/Jarvis.app' '/path/to/Jarvis.dmg'
```

The command stops at the first failed check. It requires strict signature verification, a hardened-runtime flag in the app's signature metadata, Gatekeeper execution assessment, stapled tickets on both app and DMG, and Gatekeeper disk-image assessment. Missing tools, metadata or tickets fail the gate. This verifier does not sign, submit, staple or publish anything. Its fixture tests establish command routing and rejection behavior, not Apple acceptance.

Before distribution, separately demonstrate packaged native-module compatibility, install/relaunch and SQLite persistence on clean supported Macs, and record version, architecture, source revision and artifact checksums. A successful verification of one architecture does not qualify another.

## Recovery

Retain the previous verified installer and a user-controlled data backup. Before documenting downgrade as supported, test the previous app against the current storage schema; otherwise restore the compatible backup with the matching version. Do not promise automatic rollback or automatic updates: neither is implemented. Stop distribution when a signing, notarization or storage compatibility gate fails.
