# Subscription Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove supported ChatGPT and Claude subscription integration using the founder's accounts, and establish the route to Jarvis's paid monthly distribution.

**Architecture:** Resolve access before committing to production adapters. A small local harness owns its transcript and drives each supported provider interface. Keep the interface reusable; discard experimental transport code that does not meet the gate.

**Tech Stack:** Existing TypeScript/Vitest; provider-supported SDKs or official executables selected from current documentation. No UI framework change.

**Spec:** [Jarvis MVP design](../specs/2026-10-21-jarvis-mvp-design.md)

## Global Constraints

- First pair: ChatGPT + Claude, confirmed during planning.
- MVP scope: text chat + switching + memory, confirmed during planning.
- Use users' existing provider subscriptions.
- No separate paid API or hidden provider fallback.
- Commercial launch: users pay a monthly Jarvis subscription for the app and shared memory, while retaining their separate AI subscriptions.
- The founder has both ChatGPT and Claude subscriptions available for the access test; exact plan eligibility still needs verification.

## Review Focus

1. An account logs in but requests consume a separate API balance or commercial eligibility remains unresolved → distinguish live entitlement from paid-launch readiness; Task 1/3 evidence.
2. An official agent enables tools by default → text-only requests cannot access filesystem/shell; Task 2 adapter test and Task 3 live check.
3. Unsupported model/settings appear usable → reject locally and refresh capabilities; Task 2 contract tests.
4. Authentication expires or quota runs out → clear typed error, no retry/fallback loop; Task 2 contract tests.
5. Switching carries an opaque provider session instead of app history → B can use A's visible text; Task 3 live handoff.

---

## Starting state and execution order

The existing app is a UI demo: `src/App.tsx` simulates replies; `src/lib/models.ts` contains placeholder models; `src/lib/chats.ts` stores chats in localStorage. No live integration or desktop runtime exists. The directory had no `.git` at planning time.

Execute this plan before the [full MVP plan](2026-10-21-jarvis-shared-memory-mvp.md). Task 1 is a decision/evidence task, not speculative code. Independent storage/memory work in that plan can proceed with fakes while access is unresolved; do not describe that as completion of this milestone.

Do not install a reverse-engineered client merely because its source was inspected. We already have source evidence; the missing proof is supported live subscription access.

### Task 1: Resolve the supported route for each confirmed provider

**Files:**
- Read: `docs/research/2026-10-21-subscription-model-switching.md`
- Create: `docs/research/2026-10-21-subscription-access-validation.md`
- Create after resolution: `desktop/providers/routes.json`

**Interfaces:**
- Produces one `RouteDecision` per provider: `{ providerId: 'chatgpt' | 'claude'; status: 'eligible' | 'blocked'; mechanism: string; officialSources: string[]; checkedAt: string; testedVersion: string | null; prototypeScope: string; distributionScope: string; entitlementEvidence: string; reason: string | null }`.
- `eligible` requires an identified documented route covering our prototype, not merely a working credential.

- [ ] Recheck OpenAI Sign in with ChatGPT eligibility and Claude's hosting/SDK restrictions using the official sources in the research record. Record the exact applicable authentication and text-inference interfaces, supported text-only mode, and model discovery mechanism.
- [ ] Assess both the local prototype and the confirmed paid monthly app. For OpenAI, identify the commercial participation path; for Claude, determine whether the exact native-binary integration qualifies or requires approval. Owning subscriptions is test readiness, not evidence of distribution eligibility. Record unresolved provider clarification and prepare concrete request text if useful; do not send it without instruction.
- [ ] Record subscription entitlement separately from authentication. Note how the live test can demonstrate the request uses the subscription route rather than API credit. Unknown usage must remain “unverified.”
- [ ] Write `routes.json` only for eligible routes; keep secrets out. If Claude is blocked, stop Claude-dependent work. Do not substitute Grok, Gemini, API billing, copied OAuth credentials, or DOM automation.
- [ ] Verify the record answers, for both providers: route, eligibility, auth, quota source, text-only behavior, version, evidence, distribution limit. This is a manual evidence review; no invented unit test for documentation.

**Done:** two concrete routes ready to test, or a precise blocker and the independent work that can continue. A blocked result completes the investigation, not the two-provider milestone.

### Task 2: Build a minimal adapter harness for eligible routes

**Files:**
- Create: `src/shared/contracts.ts` — shared types from the spec.
- Create: `desktop/providers/types.ts` — `SubscriptionAdapter` and provider-only types from the spec.
- Create: `desktop/providers/chatgpt.ts`, `desktop/providers/claude.ts` — only after each route qualifies.
- Create: `desktop/providers/registry.ts` — explicit provider selection.
- Create: `scripts/subscription-smoke.ts` — local interactive smoke runner, no transcript persistence.
- Modify: `package.json`, `package-lock.json`, `tsconfig.json` — add only required tooling and verified supported dependencies; include new TypeScript paths.
- Test: `tests/providers/contracts.test.ts`

**Interfaces:**
- Produces `createChatgptAdapter(): SubscriptionAdapter`, `createClaudeAdapter(): SubscriptionAdapter`, `getAdapter(id: ProviderId): SubscriptionAdapter`.
- Implements the exact `SubscriptionAdapter`, `ProviderRequest`, `ProviderEvent`, and `ModelDescriptor` contracts in the spec.
- Produces `npm run smoke:subscription -- --provider chatgpt` and `--provider claude`. The harness invokes `connect`, `status`, `listModels`, and `stream`; it prints redacted status and text only.

- [ ] Add failing adapter contract tests using a controlled transport fixture. Assert streamed deltas preserve order, an aborted signal ends the stream, auth errors map to `auth`, quota errors map to `quota`, invalid models/settings are rejected, and no alternate provider/API path is invoked. Assert attempted tool requests are rejected without execution.
- [ ] Run `npm test -- tests/providers/contracts.test.ts`; expect failure because the adapters/contract do not yet exist.
- [ ] Implement the interfaces using Task 1's chosen official mechanisms. Preserve required native authentication flows. Keep tools disabled. Use only fields supported by that provider; translate client-owned history and instructions explicitly. Mocks are test-only.
- [ ] Add the interactive harness and scripts. Provider-supported auth owns credentials where possible. If a route requires app-owned secrets, implement the encrypted desktop secret store from MVP Task 1 before live login; do not create an interim plaintext store. Never request credentials in chat.
- [ ] Run `npm test -- tests/providers/contracts.test.ts` and `npm run build`; expect all contract assertions and TypeScript/build checks to pass. These are software checks, not live feasibility evidence.
- [ ] If git exists at execution time, commit only this task's files: `feat: add subscription adapters`. If it does not, establish a local baseline before implementation commits; do not create a remote or push.

### Task 3: Prove subscription use and automatic handoff live

**Files:**
- Modify: `scripts/subscription-smoke.ts`
- Update: `docs/research/2026-10-21-subscription-access-validation.md`
- Optional redacted fixture: `tests/fixtures/providers/stream-events.json`

**Interfaces:**
- Consumes `getAdapter(id)`, `SubscriptionAdapter.stream(request, signal)`, and app-owned `ContextBundle`.
- Produces `npm run smoke:subscription -- --handoff chatgpt,claude,chatgpt` and a dated pass/fail evidence record.

- [ ] Add handoff mode: use the selected entitled model from each catalog, replay the harness's visible transcript, and start an independent provider session when needed. Do not pass opaque thread IDs across providers.
- [ ] Use the founder's existing accounts, verifying their actual plan eligibility during native/provider-supported sign-in. Run both single-provider commands using synthetic content such as “For this test, Project Cedar's launch day is Tuesday.” Record successful streamed responses, route, model, app/CLI version, and subscription entitlement evidence. Do not save private account identifiers or tokens.
- [ ] Run the handoff command. A states the synthetic fact, B answers a follow-up using it, A continues from B. Confirm no manual paste, API key, or additional inference bill. If billing provenance cannot be established, mark that criterion unverified.
- [ ] Test cancellation and reconnection live. Verify text-only behavior using a harmless request to create a file in an empty temporary directory: no file/tool action may occur. Test quota/auth failures with contract fixtures if inducing a real limit would be wasteful; label simulated evidence accurately.
- [ ] Record **pass**, **blocked**, or **failed**, separately for prototype eligibility, live behavior, and distribution. Only mark the access milestone passed when both confirmed providers meet the spec's pass criteria.
- [ ] Commit the harness and redacted evidence, when git is available: `test: verify subscription handoff`.

## Handoff

A successful technical outcome supplies two tested factories to the MVP plan. Report paid-distribution eligibility separately and assess it during Task 1, not at the end of the build. A failed or blocked route supplies a concrete dependency; it does not authorize changing the product. The first live demo proves inference and transcript handoff only. Durable shared memory and Jarvis billing remain explicit later milestones.

## Unresolved questions

- Does OpenAI's commercial program cover Jarvis?
- Does Claude authorize this exact paid-app route?
