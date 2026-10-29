# Gemini and Grok connections

In the desktop app, open Settings → Subscriptions → Sign in. A provider status check must confirm account access before its plan selector and model appear. Saved plan choices are labels, never authentication evidence.

Gemini uses Google's unmodified [Antigravity CLI](https://antigravity.google/docs/install/). Grok uses the unmodified [Grok Build CLI](https://docs.x.ai/build/overview). Jarvis passes account operations to those clients; passwords and provider tokens never enter the renderer. API-key and Google Cloud billing configurations are not treated as consumer subscription sign-in.

## Local setup

The adapters look for project-local `.runtime/providers/agy` and `.runtime/providers/grok`, then standard installation locations and PATH. Explicit executable overrides are `JARVIS_GEMINI_CLI` and `JARVIS_GROK_BIN`. Runtime binaries are ignored by git. The tested local versions are Antigravity 1.4.9 and Grok Build 1.0.70; Grok rejects older versions.

Gemini uses Antigravity's shared Google-account login on this Mac. Its sign-out control explains the shared effect. Grok uses a Jarvis-owned `GROK_HOME` under Electron user data, so signing out here preserves terminal Grok's separate account.

## Chat boundary

Both adapters stream text through the desktop task coordinator and preserve conversation history, user instructions, text attachments, cancellation, and queued follow-ups. Binary attachments are rejected before a draft is cleared. Gemini selects an actual Gemini slug from the CLI model list; Grok uses the client's default model. Neither displays a fabricated model version.

Chat agents disable tools and automatic permission approval. Gemini waits for an initialization event confirming the selected model, custom agent, and empty tools before sending the prompt. Incompatible protocol output produces an explicit error. Grok disables CLI prompt expansion and applies explicit tool restrictions. Provider processes must close before interrupted work is continued.

## Verification boundary

Automated checks cover account lifecycle failures/races, IPC trust, process cleanup, provider stream protocols, request routing, history preservation, unsupported media, and sign-in gates. Browser checks use isolated accounts and include dark/light/mobile screenshots. Official binary help/version and non-generating account checks supplement these fixtures.

Local verification on 2026-10-28: 318 tests passed; production build and backend typecheck passed; navigation/account and provider-routing browser checks passed. Both installed clients returned a clean signed-out status without opening a browser or sending a model prompt. Gemini's final status check ran outside the filesystem sandbox after its sandboxed probe failed.

Successful browser authentication and authenticated model replies still require user-run acceptance. Fixture success is not evidence that a particular subscription has been accepted by either service. Gemini's successful quota parser follows Google's published usage report; actual authenticated output still needs that live check.
