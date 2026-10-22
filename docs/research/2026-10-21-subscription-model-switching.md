# Subscription-backed model switching — research

Checked October 21, 2026. Two research agents investigated provider support and existing apps; the main agent independently inspected relevant source paths.

**Finding:** Public implementations exist for a unified interface using existing provider subscriptions. The closest inspected interface is Happy. A production-ready, provider-authorized commercial implementation spanning all four providers, with automatic memory across projects, was not established by this investigation.

The product requirement remains: one desktop chat interface, a model picker, each user's existing provider subscriptions, automatic conversation continuity, and persistent memory spanning conversations and multiple projects. Separate API billing and manual clipboard handoffs are different products, not equivalent MVP reductions.

## Existing implementations

| App | Source-observed mechanism | What it establishes | Remaining limits |
| --- | --- | --- | --- |
| [Happy Desktop](https://github.com/slopus/happy-desktop) / [Happy Agent](https://github.com/slopus/happy-agent) | Claude Agent SDK; Codex and Grok clients reuse local CLI credentials and send provider requests. | Unified model selection and automatic history handoff across incompatible providers. | Source presence does not prove live account compatibility or provider permission. Inspected Gemini path requires an API key. Automatic global memory was not established. |
| [Multi-AI Chat Desktop](https://github.com/TED-H-com/multi-ai-chat-desktop) | Tauri webviews load actual provider websites, retain separate login profiles, and automate input/send/response extraction. | Concrete design for reusing web subscriptions across ChatGPT, Claude, Gemini, and Grok. | Maintainer reports incomplete live verification and Grok Cloudflare blockage on macOS. Context replay is bounded to the same app conversation. |
| [Alex](https://github.com/OpenMined/alex) | Local Rust proxy imports CLI credentials, routes models/accounts, translates request formats, and records traces. | Concrete provider-adapter and transcript-storage architecture. | Claude path uses a broker that reproduces CLI request characteristics; it is not equivalent to simply running an unmodified official CLI. Current permission/reliability not established. |

**Happy evidence.** Snapshot `0473059a7157c25d7b5f37411e4a42da849deb0b`.

- [ClaudeSession.ts](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/claude/ClaudeSession.ts#L530-L559) invokes the official Claude Agent SDK. [SDK options](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/claude/impl/toClaudeSdkOptions.ts#L124-L142) support native Claude configuration and explicit OAuth credentials.
- [Codex auth](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/codex/impl/auth.ts#L43-L84) loads local CLI credentials; [client construction](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/codex/impl/createCodexClient.ts#L89-L117) uses those for requests to the Codex backend. This is a direct endpoint client, not an unmodified Codex CLI wrapper.
- [Grok auth](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/grok/impl/auth.ts#L19-L36) and [endpoint configuration](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/grok/impl/grokConstants.ts#L1-L3) likewise implement a direct client using locally stored credentials.
- [AgentBase.ts](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-agent-base/sources/AgentBase.ts#L3873-L3980) resets incompatible provider inference context. [ModelSwitchModule.ts](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-agent-modules/sources/modelSwitch/ModelSwitchModule.ts#L14-L106) then supplies a history excerpt, capped at 32,000 characters, and access to a history-reading tool. Archived transcript continuity is verified; lossless transfer of provider-private state is not.
- [GeminiApiKeyCredential.ts](https://github.com/slopus/happy-agent/blob/0473059a7157c25d7b5f37411e4a42da849deb0b/packages/happy-providers/sources/vendors/gemini/GeminiApiKeyCredential.ts#L13-L29) establishes API-key support only for the inspected route.

**Multi-AI Chat Desktop evidence.** Snapshot `6bcf904dfce890f7ebe198cbfc329bf8d685ce62`.

- [webviews.rs](https://github.com/TED-H-com/multi-ai-chat-desktop/blob/6bcf904dfce890f7ebe198cbfc329bf8d685ce62/src-tauri/src/webviews.rs#L1082-L1141) creates provider-specific profiles, loads external website URLs, and injects the automation bridge.
- [ChatGPT adapter](https://github.com/TED-H-com/multi-ai-chat-desktop/blob/6bcf904dfce890f7ebe198cbfc329bf8d685ce62/adapters/chatgpt.json#L7-L22) identifies website controls and responses.
- [conversationContinuity.ts](https://github.com/TED-H-com/multi-ai-chat-desktop/blob/6bcf904dfce890f7ebe198cbfc329bf8d685ce62/src/ui/conversationContinuity.ts#L5-L114) replays at most 16 messages, 2,500 characters each, 12,000 total, and starts fresh provider sessions when local conversations change. This is same-conversation continuity, not maintained memory across projects.
- [Maintainer verification record](https://github.com/TED-H-com/multi-ai-chat-desktop/blob/6bcf904dfce890f7ebe198cbfc329bf8d685ce62/README.md#L109-L118) explicitly records partial macOS verification, Grok blockage, and no fresh live-account retest for the latest changes. No claim of four-provider live success is justified.

**Alex evidence.** Snapshot `c418294093ecc5a5b1736c98311e2a2b51c812af`.

- [Credential import dispatch](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/crates/alex-auth/src/lib.rs#L1781-L1804) routes to provider import implementations.
- [Provider planning](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/crates/alex-proxy/src/lib.rs#L10454-L10590) chooses the upstream adapter. [OpenAI branch](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/crates/alex-proxy/src/lib.rs#L10635-L10708) distinguishes subscription OAuth from API-key requests.
- [Dario design](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/docs/dario.md#L3-L15) and [request-shape handling](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/docs/dario.md#L58-L90) describe a compatibility broker. This should not be mistaken for documented third-party subscription authorization.
- [Trace storage](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/docs/traces.md#L12-L30) and [transcript reconstruction](https://github.com/OpenMined/alex/blob/c418294093ecc5a5b1736c98311e2a2b51c812af/docs/traces.md#L81-L105) establish local conversation capture. Automatic durable-fact extraction and cross-project retrieval were not established in the inspected paths.

## Current official provider support

| Provider | Documented route | Boundary relevant to this product |
| --- | --- | --- |
| ChatGPT | Sign in with ChatGPT can authorize eligible Responses requests against the user's plan in locally hosted open-source apps. | Paid or remotely hosted apps are directed to an interest form. Sign-in does not provide existing ChatGPT history or account context. [Official OpenAI documentation](https://developers.openai.com/siwc/token-sharing-open-source) |
| Claude | Products may run published, unmodified Claude Code under stated conditions, preserving native authentication and letting users authenticate themselves. | Custom products offering Claude.ai login or subscription limits are restricted without approval, explicitly including the Agent SDK. The hosting exception does not establish a blanket grant for a general chat wrapper. [Hosting and credential rules](https://code.claude.com/docs/en/legal-and-compliance), [SDK restriction](https://code.claude.com/docs/en/agent-sdk/overview) |
| Gemini | Consumer Gemini CLI access transitioned to Antigravity. | Google explicitly excludes third-party apps wrapping Antigravity CLI under consumer plans. The API alternative changes the requested subscription-usage model. [Transition](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/), [FAQ](https://www.antigravity.google/docs/faq/) |
| Grok | Grok Build includes subscriber access and documents ACP for tool/IDE integrations, bots, and orchestration apps. | A general-purpose chat replacement is not explicitly cleared by the checked sources; broad competing-product restrictions remain relevant. [Subscriber announcement](https://x.ai/news/grok-build-cli), [ACP integration](https://docs.x.ai/build/cli/headless-scripting), [AUP](https://x.ai/legal/acceptable-use-policy) |

API credits bundled with some subscriptions are a separate mechanism. For example, [Claude Max credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers) require Console linking/API credentials and do not make the regular Claude chat quota available to a custom client.

## Product implications

**Product coverage clarification (follow-up).** Subscription-funded model inference, an embeddable coding agent, and the complete native Chat/Work/Cowork product are separate capabilities. This research does not establish all three for every provider.

- OpenAI's [Sign in with ChatGPT preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) exclude hosted MCP/connectors, image generation, file search, Code Interpreter, and native computer use on that route. Local tools may be supplied separately. [Codex App Server](https://learn.chatgpt.com/docs/app-server) documents embedding Codex authentication, threads, approvals, and streamed events, with experimental maturity limitations. Neither establishes full ChatGPT Chat/Work feature parity or native account-memory import.
- Claude Code can provide general responses and agent tools, but full Claude Chat/Cowork reuse was not established. Official [Cowork project documentation](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork) says those projects are unavailable in Claude Code. Some account functionality is portable: [installed plugins sync to subscription-authenticated Claude Code](https://support.claude.com/en/articles/13837440-use-plugins-in-claude), including local skills/hooks/subagents/MCP servers; this is not full conversation/project/memory transfer. Custom-product authentication restrictions still apply.
- Gemini consumer-wrapper coverage remains unestablished; Grok Build ACP establishes a specific agent interface, not full native Grok product parity.

**Engineering inference:** The reusable pattern is an app-owned transcript and memory store connected to separate provider adapters. On each turn, retrieve relevant personal/project facts, assemble a bounded context, call the selected authorized provider route, and save the result. A model switch automatically creates or resumes the appropriate provider session and supplies the app's context. Provider-private reasoning state and native memories are not assumed portable.

This is a proposed architecture, not an assertion that the inspected apps implement the entire memory system. The source research supports the switching and context-handoff parts. Persistent facts, provenance, updates, scope, deletion, and cross-project retrieval still need an implementation and quality evaluation for this product.

**Recommended next milestone:** a local integration spike proving subscriber login, one streaming reply from each of two providers, automatic model switching, and reuse of a saved fact in a fresh conversation. ChatGPT's documented local OSS route is the strongest starting point. Grok ACP is the strongest second documented integration candidate, with general-chat/distribution scope unresolved. If ChatGPT + Claude is the required pair, resolve the permitted Claude integration rather than silently substituting API billing. Do not commit the commercial product to all four providers on current evidence.

Open questions:

- Which second provider authorizes this exact product/distribution model?
- Can that route pass a live subscription-backed test without separate API usage?
- How reliably does memory survive a model switch and a new project?

## Method and limits

- Inspected official documentation and pinned public source through GitHub CLI and local read-only checkouts.
- No provider sign-in, token extraction, model inference, app installation, or live-account compatibility test was performed. Reading source that accesses credentials does not mean executing that code.
- No claim that the searched apps exhaust the market or that an unverified feature is absent everywhere.
- Installed [reverse-engineer-anything](https://github.com/morluto/rea/tree/c537c52c96b7f24ea2d2c1b5ae8055fbf6d99ffa/.agents/skills/reverse-engineer-anything), version 44, at `/Users/dereksu/.codex/skills/reverse-engineer-anything`. The skill instructs using ordinary repository tools for complete source trees, so binary analysis and REA MCP setup were unnecessary. Installing the skill does not install the REA MCP server or analysis engines.
- Local source checkouts: `/tmp/jarvis-research-happy-agent`, `/tmp/jarvis-research-multi-ai-chat`, `/tmp/jarvis-alex-research`.
