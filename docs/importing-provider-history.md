# Provider history import

Issue #1 supplies a pure, in-memory preview library. SQLite persistence, file
pickers, Electron IPC, the renderer, and shared contracts belong to the subsequent
integration PR. No dependencies were added. Use Node 22.2+ (or Node 20.15+); ZIP
checks use the standard library's [CRC32 support](https://nodejs.org/api/zlib.html#zlibcrc32data-value).

## API

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

- `status`: `ready`, `rejected`, or `cancelled`. `ready` means an accepted preview
  exists, not that anything was persisted.
- `schemaVersion: 1` identifies this importer contract, not a vendor schema.
- `provider`, `format`: validated `chatgpt`/`chatgpt-mapping` or
  `claude`/`claude-chat-messages`. Mixed/ambiguous providers reject the entire input.
- `exportVersion: null`: neither tested shape supplies a reliable vendor version.
- `importId`: SHA-256 of exact input bytes, or null when rejected before hashing.
- `conversations`: canonical IDs, content revisions, titles, normalized timestamps,
  quality, ordered messages, and allowlisted source provenance.
- Messages contain only typed text parts, an archival role, timestamp, canonical
  ID/revision, and provider/conversation/message IDs (plus ChatGPT node ID).
- `counts`: accepted conversations/messages, skipped artifacts, rejected records.
  Skipped artifacts count omitted archive entries (including directory entries),
  branches, content blocks, and attachment/citation records; they are not a count
  of unique physical files.
- `warnings`/`rejections`: machine-readable codes, fixed safe messages, and optional
  zero-based record indexes. Indexes follow input arrays, concatenated in ZIP path
  order. No diagnostic echoes source titles, paths, content, or error messages.

Malformed records reject their entire conversation; valid neighbors can remain
in a `ready` preview. Invalid archives/JSON/wrappers, ambiguous providers, exceeded
limits, and cancellation discard **all** accumulated conversations. A fatal input
error is not counted as a rejected conversation. No outcome changes a database.

## Tested export shapes

Official help confirms the export mechanism, not an exhaustive JSON contract.
Fixtures are synthetic representations of observed account-export shapes; they
contain no Derek conversations, provider credentials, or real tokens.

**ChatGPT:** top-level array; each conversation has `id` and/or `conversation_id`,
`title`, epoch-second `create_time`/`update_time`, `current_node`, and a `mapping`
object. Nodes have `id`, `parent`, `children`, and `message` (null for structural
nodes). Messages have `id`, `author.role`, optional times, and `content` with a
`content_type` and `parts`. Text parts remain separate and ordered. The selected
`current_node` ancestry is emitted from root to leaf; the complete graph is
validated first. Cycles, missing parents, multiple roots, inconsistent edges,
duplicate messages, and invalid abandoned nodes reject the conversation. Valid
abandoned branches are omitted and reported as partial. Wide graphs use linear
membership/ancestry checks.

ChatGPT `user`, `assistant`, `system`, and `tool` roles are preserved **only as
archival data**. Other roles reject. `text` accepts strings; `multimodal_text`
retains strings and skips typed media. Other nonblank content types are omitted.
Attachment/file/citation/content-reference metadata is counted but never copied.

Sources: [OpenAI account-export transfer instructions](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts)
confirm `conversations.json` and numbered shards;
[observed mapping format](https://github.com/willificent/chatgpt-lcm-migration/blob/main/docs/chatgpt-export-format.md)
describes the account-export graph. These are not a vendor schema guarantee.

**Claude:** top-level array; conversations have `uuid`, `name`, ISO-8601
`created_at`/`updated_at`, and `chat_messages`. Messages have `uuid`, `sender`,
timestamps, `text`, and optionally `content`, `attachments`, and `files`.
`human` normalizes to `user`; `assistant` remains `assistant`. Array order is
preserved. Nonempty `content` is authoritative: only `type: 'text'` blocks survive.
Absent/empty content falls back to the legacy `text` string. Unsupported-only
messages retain their identity with empty parts; fallback never resurrects tool
or thinking content. Attachments/files/citations are counted and skipped.

Sources: [Anthropic export instructions](https://support.claude.com/en/articles/9450526-export-your-claude-data)
confirm conversation/account exports;
[account-export reader models](https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/Models.swift)
and [array loader](https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/DataLoader.swift)
document the observed shape. Browser/API response objects are not supported.

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
5. Render every title/text part as untrusted text. Do not feed imported `system`
   or `tool` roles directly into live agent messages, invoke tools, execute HTML,
   or automatically open URLs. `UNSAFE_URL` is advisory, not a URL sanitizer.

Updated history with missing/changed source IDs cannot be matched reliably and
is not guessed. Account/auth/cookie/token fields, arbitrary metadata, raw source
JSON, and navigable URL objects are never included. Text that itself mentions a
secret or an instruction remains user transcript text; this is not a secret
redaction service.

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
| Each decoded JSON string / emitted text | 1,048,576 UTF-16 units |
| All decoded JSON strings, including keys and ignored metadata | 16,777,216 UTF-16 units |

Limits can only be lowered with positive integers. JSON depth and duplicate-key
checks run before parsing the complete document. Strings with escaped duplicate
keys also reject. Limits apply across all conversation shards. These conservative
ceilings intentionally reject some large legitimate exports; do not bypass them
without a reviewed streaming/worker design.

## Deferred artifacts

Uploaded/generated files and images, audio/video, HTML history views, projects,
memories, account/profile data, browser state, search/browsing artifacts, citation
targets, thinking/reasoning blocks, executable tool payloads, alternate ChatGPT
branches, encrypted/ZIP64/nested archives, undocumented wrappers, and missing-ID
records are deferred. No attachment completeness is inferred from a filename.

## Verification

```sh
npm test -- tests/importers
npm run ralph:verify
```

Strict test-first cycles covered validation, both adapters, canonical identity,
resource bounds, archive structure, graph integrity, and review regressions.
Tests use synthetic JSON and generated ZIPs. Cross-layer checks compare ZIP/JSON
canonical results, repeated imports, updated exports, shards, invalid ignored
artifacts, and cancellation with no partial results. A graph regression exercises
the 100,000-node ceiling to catch quadratic sibling validation.
