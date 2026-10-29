# Verified provider connections

User approved real Gemini and Grok sign-in integrations, after requesting sign-in before plan choice.

- Use official subscription-backed provider clients; no developer API-key substitute or website-opened success flag.
- State flow: unavailable client → install instructions → signed out → signing in → verified connected. Poll only during the login window; support cancel, expiry, failure, and sign-out.
- Keep provider credentials in the official client/main process. Expose only account display metadata through preload.
- Hide plan selectors and provider models until verified connected. Stored plan strings do not grant connection or inference access. Preserve existing stored choices without treating them as authentication.
- Connect default-provider models to actual task adapters when a documented safe transport exists. Reject unsupported media explicitly. Preserve stop, queued instructions, history, and process cleanup.
- Use existing subscription-row design and outlined account buttons. Keep ordinary chat tool permissions restricted; never enable auto-approval to make a CLI work.
- Verify status/login failure cases and streaming with isolated fixtures, real CLI help where available, frontend login gating, and two localhost visual passes. Live account login remains the user's action.

Implemented: native auth/status/cancel/logout bridges; subscription-gated plans and models; text task adapters; scoped IPC; official local clients; account lifecycle, routing, protocol, and browser regression checks. See [connection notes](../../provider-connections.md) for setup and live-validation limits.

Unresolved user questions: none. Successful browser login and authenticated replies remain user-run acceptance checks.
