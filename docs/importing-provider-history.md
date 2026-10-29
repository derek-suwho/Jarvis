# Onboarding imports: conversation history and agent setup

Issue #1 supplies a pure, in-memory preview library. SQLite persistence, file
pickers, Electron IPC, the renderer, and shared contracts belong to the subsequent
integration PR. No dependencies were added. Use Node 22.2+ (or Node 20.15+); ZIP
checks use the standard library's [CRC32 support](https://nodejs.org/api/zlib.html#zlibcrc32data-value).

## Final product scope

The [final issue decision](https://github.com/derek-suwho/Jarvis/issues/1#issuecomment-6508817026)
supersedes earlier download-watching/no-picker proposals. This is a selective
onboarding migration, not a recreation or continuous synchronization of provider
memory systems.

- **Consumer history:** the user selects an official ChatGPT or Claude JSON/ZIP
  export. No email/mailbox access, browser scraping, automatic cloud sync, or
  Downloads-folder watching is part of this feature.
- **Local agent setup:** separately select instructions, skills/plugins, MCP
  configuration, project metadata, and supported project memories from available
  Claude Code/Cowork/Codex state. This PR delivers metadata-only contracts and
  selection planning; discovery, source-file adapters, and payload transfer remain
  unimplemented. A source name in the contract is not a claim of tested local paths.
- **Safety:** credentials/tokens never migrate. Hooks remain disabled. Plugins
  and MCP servers require separate explicit user review before activation.
- **Jarvis memory:** starts mostly fresh and grows from activity inside Jarvis.
  The importer encodes `exclude-from-automatic-memory` for historical conversations
  and project-reference-only use for selected project-memory assets. Preserving
  these policies in persistence, search, queues, and memory extraction is required
  integration work; this PR does not implement or verify that enforcement.

## Consumer history API

```ts
import { importProviderHistory } from '../desktop/importers';

const preview = await importProviderHistory(bytes, {
  provider: 'chatgpt', // optional consistency check, never forces detection
  signal: controller.signal,
  limits: { maxInputBytes: 8 * 1024 * 1024 }, // optional, lower ceilings only
});
```

`input` is a JSON string or `Uint8Array` containing UTF-8 JSON/ZIP bytes. The
caller owns file selection and reading. The importer snapshots input before
yielding, never accesses the filesystem/network, and never executes imported
HTML, scripts, tools, URLs, or instructions.

The public types live in `desktop/importers/types.ts`:

- `mode: 'consumer-history'` distinguishes history from setup selection plans.
- The importer encodes `memoryPolicy: 'exclude-from-automatic-memory'` on every
  result (including rejection/cancellation) and each accepted conversation.
  Import options and provider metadata cannot override this encoded value.
  It does not itself enforce persistence, search, queue, or memory-extractor policy.
- `status`: `ready`, `rejected`, or `cancelled`. `ready` means an accepted preview
  exists, not that anything was persisted.
- `schemaVersion: 1` identifies this importer contract, not a vendor schema.
- `provider`, `format`: validated `chatgpt`/`chatgpt-mapping` or
  `claude`/`claude-chat-messages`. Mixed/ambiguous providers reject the entire input.
- `exportVersion: null`: neither tested shape supplies a reliable vendor version.
- `importId`: SHA-256 of exact input bytes, or null when rejected before hashing.
- `conversations`: canonical IDs, content revisions, titles, normalized timestamps,
  quality, ordered messages, and allowlisted source provenance.
- Messages contain only typed text parts, a `user` or `assistant` role, timestamp, canonical
  ID/revision, and provider/conversation/message IDs (plus ChatGPT node ID).
- `counts`: accepted conversations/messages, skipped artifacts, rejected records.
  Skipped artifacts count omitted archive entries (including directory entries),
  branches, hidden system/tool messages, content blocks, and attachment/citation
  records; they are not a count of unique physical files.
- `warnings`/`rejections`: machine-readable codes, fixed safe messages, and optional
  zero-based record indexes. Indexes follow input arrays, concatenated in ZIP path
  order. No diagnostic echoes source titles, paths, content, or error messages.

Malformed records reject their entire conversation; valid neighbors can remain
in a `ready` preview. Invalid archives/JSON/wrappers, ambiguous providers, exceeded
limits, and cancellation discard **all** accumulated conversations. A fatal input
error is not counted as a rejected conversation. No outcome changes a database.

## Tested export shapes

Fixtures are synthetic test inputs for the shapes described below. They do not
establish compatibility with current real exports or an official stable schema.
No sanitized current real-export fixtures were available for this PR. Fixtures
must contain no real conversations, credentials, tokens, cookies, names, or other
personal data.

**Required pre-production gate:** validate both adapters against sanitized current
ChatGPT and Claude account exports before claiming production compatibility.
Record the export date, sanitization method, retained structural cases, and results;
replace all personal content and identifiers before any fixture is committed.
Retain the synthetic fixtures as adversarial units. Export-help pages and third-party
readers are references, not substitutes for this gate or vendor schema guarantees.

**ChatGPT:** top-level array; each conversation has `id` and/or `conversation_id`,
`title`, epoch-second `create_time`/`update_time`, `current_node`, and a `mapping`
object. Nodes have `id`, `parent`, `children`, and `message` (null for structural
nodes). Messages have `id`, `author.role`, optional times, and `content` with a
`content_type` and `parts`. Text parts remain separate and ordered. The selected
`current_node` ancestry is emitted from root to leaf; the complete graph is
validated first. Cycles, missing parents, multiple roots, inconsistent edges,
duplicate messages, and invalid abandoned nodes reject the conversation. Valid
abandoned branches are omitted and reported as partial. Graphs use linear
membership/ancestry checks. For a graph of `n` nodes, each children collection and
the global edge total are bounded by `n - 1` before traversing or allocating that
collection. Oversized collections or totals reject before processing their edges.

Only ChatGPT `user` and `assistant` dialogue is emitted. `system` and `tool`
messages are omitted, counted as skipped/unsupported, and make the conversation
partial; their text and payloads are absent from the import result. Other roles
reject. `text` accepts strings; `multimodal_text`
retains strings and skips typed media. Other nonblank content types are omitted.
Attachment/file/citation/content-reference metadata is counted but never copied.
Message metadata must be absent, null, or a plain object; arrays, strings,
primitives, and exotic prototypes reject with `INVALID_CONTENT`.

References: [OpenAI account-export transfer instructions](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts)
and [third-party mapping notes](https://github.com/willificent/chatgpt-lcm-migration/blob/main/docs/chatgpt-export-format.md).

**Claude:** top-level array; conversations have `uuid`, `name`, ISO-8601
`created_at`/`updated_at`, and `chat_messages`. Messages have `uuid`, `sender`,
timestamps, `text`, and optionally `content`, `attachments`, and `files`.
`human` normalizes to `user`; `assistant` remains `assistant`. Array order is
preserved. Nonempty `content` is authoritative: only `type: 'text'` blocks survive.
Absent/empty content falls back to the legacy `text` string. Unsupported-only
messages retain their identity with empty parts; fallback never resurrects tool
or thinking content. Attachments/files/citations are counted and skipped.

References: [Anthropic export instructions](https://support.claude.com/en/articles/9450526-export-your-claude-data),
[third-party reader models](https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/Models.swift),
and [array loader](https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/DataLoader.swift)
implementation. Browser/API response objects are not supported.

Missing timestamps become null with a warning and partial quality. Invalid dates,
roles, or required text reject the record. ISO offsets normalize to UTC; fractional
seconds normalize to milliseconds. No missing dates are replaced with the import
time. `structured` means the supported conversation shape was retained without
known omissions; `partial` means content/branches/timestamps are missing.

## Identity and integration requirements

Source IDs must be nonblank ASCII identifiers (1–256 characters: initial
alphanumeric, followed by alphanumerics, `.`, `_`, `:`, or `-`). Prototype-like
reserved IDs are rejected. Missing/object-valued IDs receive no invented fallback.
Both ChatGPT ID aliases must agree.

Canonical conversation IDs hash `[provider, sourceConversationId]`; message IDs
hash `[provider, sourceConversationId, sourceMessageId]`, with distinct prefixes.
They do not depend on title, timestamps, message content, JSON key order, ZIP
packaging, or archive identity. Revisions hash the allowlisted canonical content.
Changed content with unchanged metadata changes the revision and keeps its ID.
Identical normalized duplicates collapse; conflicting content or completeness
reports reject all duplicates. Malformed records taint every valid ID alias they
claim, so an ambiguous duplicate cannot silently coexist with an accepted twin.

The integration owner must:

1. Present the complete preview and rejections before committing.
2. Treat conversation messages as an **ordered authoritative snapshot**. Upsert
   by canonical ID and reconcile removed/reordered messages transactionally.
   A changed ChatGPT active branch must not leave stale prior-branch messages.
3. Persist archive identity/revisions as appropriate for import history; use
   canonical IDs for deduplication across updated/repackaged exports.
4. Recheck cancellation before committing and roll back any failure. This library
   has no database handle, so persistence idempotency/transactions remain an
   integration responsibility.
5. Render every title/text part as untrusted text. Never interpret imported text
   as live agent instructions, invoke tools, execute HTML, or automatically open
   URLs. `UNSAFE_URL` is advisory, not a URL sanitizer.
6. Preserve the conversation's memory policy through persistence and search.
   Imported-message insertions must not enqueue the durable-memory extractor.
   Re-imports, branch updates, and retrieved historical context do not count as
   new activity originating inside Jarvis. Add integration tests proving
   persistence/search preserve the encoded policy and these operations never queue
   or invoke memory extraction. The importer only encodes the policy; this PR
   neither implements nor verifies those cross-layer guarantees.

Updated history with missing/changed source IDs cannot be matched reliably and
is not guessed. Account/auth/cookie/token fields, arbitrary metadata, raw source
JSON, and navigable URL objects are never included. Text that itself mentions a
secret or an instruction remains user transcript text; this is not a secret
redaction service.

## Agent setup selection contracts

`desktop/importers/setup-types.ts` defines `SetupAssetDescriptor`, `SetupSelection`,
and `SetupSelectionPlan`; `createSetupImportPlan` validates metadata and produces
an inert plan. It performs no local discovery, content parsing, payload import,
installation, execution, activation, credential access, or memory writes.

Future adapters must provide a descriptor containing **only**:

| Field | Meaning |
| --- | --- |
| `source` | `claude-code`, `claude-cowork`, or `codex` |
| `sourceId` | Stable bounded opaque asset identifier; never a filesystem path |
| `category` | `instructions`, `skill`, `plugin`, `mcp-server`, `project`, `project-memory`, or `hook` |
| `scope` | `{ kind: 'user' }` or `{ kind: 'project', projectId }`; projects/memories require project scope |
| `contentDigest` | Lowercase SHA-256 of the adapter's credential-free normalized asset |

```ts
import { createSetupImportPlan } from '../desktop/importers';

const preview = createSetupImportPlan(descriptors);
// The integration UI records the user's actual selected items and revisions.
const plan = createSetupImportPlan(descriptors, selectedReferences);
```

`selectedReferences` contains `{ id, revision }` pairs from a prior plan. Omitting
it selects nothing. Unknown, duplicate, stale, or malformed selections reject the
entire plan. Selection cannot express approval/enablement. Conflicting descriptors
reject; identical repeats collapse. Asset IDs are namespaced by source, category,
scope, and source ID. Content changes preserve identity and change revision.
Future review/activation must bind its separate approval to that current revision.

Every output item has `enabled: false`. Hooks have `activation: 'disabled'`;
plugins/MCP have `activation: 'requires-explicit-review'`; other assets remain
`not-activated`. Project memories additionally carry `memoryUse:
'project-reference-only'`. The plan encodes `exclude-from-automatic-memory`.
These are integration requirements, not an implemented installer or authorization
service; selection alone must never be used to start an executable component.

The contract carries no raw settings, text, labels, paths, URLs, command arguments,
environment, headers, or credential payloads. Unknown fields—including `enabled`
or `reviewed`—reject instead of passing through. Source/project identifiers become
hashed references in the output. Descriptors and selections are limited to 1,000
each; source/project identifiers use the same 256-character rules as history IDs.
All diagnostics are fixed messages. Plans are detached from caller objects.

This metadata-only boundary is **not a credential sanitizer** and cannot verify
the content behind a supplied digest. Source adapters must separately validate
approved roots, reject credential files/fields, sanitize supported assets, and
verify the digest at transfer/review time. No actual Claude Code/Cowork/Codex setup
files have been parsed by this PR; the setup fixture is a synthetic descriptor
contract, not a vendor export. Exact Cowork paths and supported project-memory
formats require later validation on a real Mac. Hooks/configuration do not become
safe merely because the user selected their descriptors.

## Archive and resource policy

Supported ZIP features: stored/deflate entries, UTF-8 (including ASCII) names,
signed/unsigned data descriptors, comments, ordinary directories, and multiple
`conversations.json` / `conversations-<digits>.json` documents in safe subdirectories.
Names select candidate documents only; adapter validation determines provider.
Empty arrays alone cannot identify a provider and reject. ZIPs must have contiguous
local entries and a consistent central directory; self-extracting prefixes and
trailing data are unsupported.

All entries, including ignored artifacts, undergo header/layout/path/type checks,
size/ratio checks, bounded inflation, and CRC validation. Rejected cases include
traversal, absolute/Windows paths, symlinks/special files, normalized duplicate
paths, overlapping entries, nested archives, ZIP64, multidisk/encrypted ZIPs,
unknown compression methods, bad UTF-8, checksum/size lies, and trailing deflate
payloads. Nothing is extracted to disk. Deflation is synchronously bounded;
cancellation yields between entries/documents/conversations, not during one
bounded inflation or JSON parse. Large imports should run in an integration worker.

| Limit | Default ceiling |
| --- | ---: |
| Input bytes | 32 MiB |
| Total extracted bytes, including ignored entries | 64 MiB |
| Each extracted file / standalone JSON | 16 MiB |
| Archive entries | 1,024 |
| Declared expansion ratio | 100:1 |
| Archive path components | 8 |
| JSON object/array depth | 64 |
| Conversations, including duplicates/rejections | 5,000 |
| Total messages / ChatGPT graph nodes, including omitted nodes | 100,000 |
| Each ChatGPT children collection / total edges in one graph | Node count minus one |
| Each decoded JSON string / emitted text | 1,048,576 UTF-16 units |
| All decoded JSON strings, including keys and ignored metadata | 16,777,216 UTF-16 units |

Limits can only be lowered with positive integers. JSON depth and duplicate-key
checks run before parsing the complete document. Strings with escaped duplicate
keys also reject. Limits apply across all conversation shards. These conservative
ceilings intentionally reject some large legitimate exports; do not bypass them
without a reviewed streaming/worker design.

## Consumer export omissions and deferred integration

Uploaded/generated files and images, audio/video, HTML history views, projects,
memories, account/profile data, browser state, search/browsing artifacts, citation
targets, thinking/reasoning blocks, executable tool payloads, alternate ChatGPT
branches, encrypted/ZIP64/nested archives, undocumented wrappers, and missing-ID
records are deferred. No attachment completeness is inferred from a filename.
This list describes consumer exports; selective local project metadata/memory is
a separate setup category, represented only by the contracts above in this PR.

User-approved local-root discovery, provider-specific setup adapters, credential
exclusion at the payload boundary, payload transfer, explicit plugin/MCP review,
and installation/activation are later integration work. Local agent transcripts
are not implemented as a third history source. File selection/permissions, SQLite,
IPC, renderer flows, and durable-memory queue enforcement remain integration-owned.
Email access, scraping, Downloads watching, and automatic cloud synchronization
are out of the final product scope, not implied follow-up features.

## Verification

```sh
npm test -- tests/importers
npm run ralph:verify
```

Strict test-first cycles covered validation, both adapters, canonical identity,
resource bounds, archive structure, graph integrity, and review regressions.
Tests use synthetic JSON and generated ZIPs. Cross-layer checks compare ZIP/JSON
canonical results, repeated imports, updated exports, shards, invalid ignored
artifacts, and cancellation with no partial results. Graph regressions use
deterministic operation/edge bounds instead of wall-clock correctness thresholds.
They check children limits before iteration/allocation and a global edge budget.
Additional test-first cases cover non-overridable history memory-policy encoding, setup
selection by revision, disabled hooks, plugin/MCP review requirements, rejected
credential/executable fields, scoped identities, and inert project-memory references.
These tests do not verify persistence, search, queue, or memory-extractor enforcement.
Current real-export compatibility remains the required pre-production gate above.
