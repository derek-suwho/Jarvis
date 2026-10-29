import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { ArchiveError, readArchive } from './archive';
import { parseChatGPT } from './chatgpt';
import { parseClaude } from './claude';
import { parseDocument } from './json';
import { RecordError, sourceId } from './validation';
import type { ParsedConversation } from './adapter-types';
import type { Diagnostic, ImportedConversation, ImportLimits, ImportOptions, ImportResult, Provider } from './types';
export type * from './types';
export { createSetupImportPlan } from './setup';
export type * from './setup-types';

export const DEFAULT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
  maxExtractedBytes: 64 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxFiles: 1024,
  maxCompressionRatio: 100,
  maxPathDepth: 8,
  maxJsonDepth: 64,
  maxConversations: 5000,
  maxMessages: 100000,
  maxTextLength: 1024 * 1024,
  maxTotalTextLength: 16 * 1024 * 1024,
});

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identity = (...parts: string[]) => hash(JSON.stringify(parts));

const messages: Record<string, string> = {
  CANCELLED: 'Import cancelled. No conversations are returned.',
  INVALID_INPUT: 'Select a UTF-8 JSON file or supported ZIP export.',
  INVALID_ENCODING: 'The conversation document is not valid UTF-8.',
  INVALID_JSON: 'The conversation document is not valid JSON.',
  INVALID_WRAPPER: 'Conversation documents must contain an array of records.',
  DUPLICATE_JSON_KEY: 'The JSON contains ambiguous duplicate object keys.',
  INVALID_LIMITS: 'Import limits must be positive integers within the built-in ceilings.',
  LIMIT_EXCEEDED: 'The export exceeds an import safety limit.',
  UNSUPPORTED_FORMAT: 'No supported provider export records were detected.',
  AMBIGUOUS_PROVIDER: 'The export contains mixed or ambiguous provider shapes.',
  PROVIDER_MISMATCH: 'The export does not match the selected provider.',
  INVALID_RECORD: 'A conversation record is malformed.',
  INVALID_MESSAGE: 'A message record is malformed.',
  INVALID_ID: 'A required source ID is missing or invalid.',
  INVALID_TIMESTAMP: 'A source timestamp is invalid.',
  INVALID_ROLE: 'A message role is invalid for this export format.',
  INVALID_CONTENT: 'A message content part is malformed.',
  DUPLICATE_MESSAGE_ID: 'A conversation contains duplicate message IDs.',
  DUPLICATE_CONVERSATION: 'An identical conversation record was collapsed.',
  DUPLICATE_CONVERSATION_ID: 'Conflicting records share a conversation ID; all were rejected.',
  GRAPH_CYCLE: 'A conversation graph contains a cycle.',
  GRAPH_MISSING_PARENT: 'A conversation graph references a missing parent.',
  GRAPH_DISCONNECTED: 'A conversation graph is disconnected.',
  GRAPH_INCONSISTENT: 'A conversation graph has inconsistent nodes or edges.',
  GRAPH_INVALID_CURRENT: 'A conversation graph has an invalid selected node.',
  ABANDONED_BRANCH: 'Only the selected branch is included; other graph nodes were skipped.',
  MISSING_TIMESTAMP: 'A timestamp is unavailable and remains unknown.',
  UNSUPPORTED_CONTENT: 'Unsupported content was skipped; the conversation is partial.',
  UNSUPPORTED_ARTIFACT: 'Non-conversation artifacts were skipped.',
  SENSITIVE_METADATA_IGNORED: 'Sensitive account or authentication metadata was ignored.',
  UNSAFE_URL: 'Potentially unsafe URLs remain inert text; do not activate imported links.',
  INVALID_ARCHIVE: 'The archive is invalid or uses unsupported ZIP features.',
  UNSAFE_ARCHIVE: 'The archive contains unsafe entries.',
  MISSING_CONVERSATIONS: 'The archive contains no supported conversation document.',
};

function diagnostic(code: string, recordIndex?: number): Diagnostic {
  return {
    code, message: messages[code] ?? 'Unsupported export data was omitted.',
    ...(recordIndex === undefined ? {} : { recordIndex }),
  };
}

function emptyResult(): ImportResult {
  return {
    mode: 'consumer-history', memoryPolicy: 'exclude-from-automatic-memory',
    status: 'rejected', schemaVersion: 1, importId: null, provider: null, format: null, exportVersion: null,
    conversations: [], counts: { conversations: 0, messages: 0, skippedArtifacts: 0, rejectedRecords: 0 },
    warnings: [], rejections: [],
  };
}

function readLimits(overrides: ImportOptions['limits']): ImportLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1 || value > limits[key as keyof ImportLimits]) {
      throw new RecordError('INVALID_LIMITS');
    }
    limits[key as keyof ImportLimits] = value;
  }
  return limits;
}

function canonical(provider: Provider, parsed: ParsedConversation): ImportedConversation {
  const id = `import-chat-${identity(provider, parsed.sourceId)}`;
  const canonicalMessages = parsed.messages.map(message => {
    const normalized = {
      id: `import-message-${identity(provider, parsed.sourceId, message.sourceId)}`,
      role: message.role, createdAt: message.createdAt,
      parts: message.parts.map(text => ({ type: 'text' as const, text })),
      provenance: {
        provider, conversationId: parsed.sourceId, messageId: message.sourceId,
        ...(message.nodeId === undefined ? {} : { nodeId: message.nodeId }),
      },
    };
    return { ...normalized, revision: hash(JSON.stringify(normalized)) };
  });
  const normalized = {
    id, title: parsed.title, createdAt: parsed.createdAt, updatedAt: parsed.updatedAt,
    memoryPolicy: 'exclude-from-automatic-memory' as const,
    quality: parsed.quality, messages: canonicalMessages,
    provenance: { provider, conversationId: parsed.sourceId },
  };
  return { ...normalized, revision: hash(JSON.stringify(normalized)) };
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RecordError('CANCELLED');
}

function providerCandidates(record: unknown, limits: ImportLimits): Provider[] {
  if (!object(record)) return [];
  const candidates: Provider[] = [];
  if (object(record.mapping) && typeof record.title === 'string' && Object.hasOwn(record, 'current_node')) {
    candidates.push('chatgpt');
  }
  if (Array.isArray(record.chat_messages) && typeof record.name === 'string' && Object.hasOwn(record, 'uuid')) {
    candidates.push('claude');
  }
  if (candidates.length < 2) return candidates;

  // Overlapping core fields may be unrelated extensions. Only two successful
  // adapters establish ambiguity; a failed candidate cannot veto a valid one.
  const validated = candidates.filter(provider => {
    try {
      (provider === 'chatgpt' ? parseChatGPT : parseClaude)(record, limits);
      return true;
    } catch (error) {
      if (!(error instanceof RecordError)) throw error;
      return false;
    }
  });
  // Retain malformed core shapes so the selected adapter can report precise
  // validation errors and reject aliases shared with an otherwise valid twin.
  return validated.length ? validated : candidates;
}

/** Pure preview only. Consumers must render as untrusted text and persist transactionally. */
export async function importProviderHistory(input: string | Uint8Array, options: ImportOptions = {}): Promise<ImportResult> {
  const result = emptyResult();
  try {
    checkCancellation(options.signal);
    const limits = readLimits(options.limits);
    if (typeof input !== 'string' && !(input instanceof Uint8Array)) throw new RecordError('INVALID_INPUT');
    const byteLength = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength;
    if (byteLength > limits.maxInputBytes) throw new RecordError('LIMIT_EXCEEDED');
    // Copy before yielding: callers cannot mutate the bytes between hashing and parsing.
    const bytes = Buffer.from(input);
    result.importId = hash(bytes);
    await yieldTurn();
    checkCancellation(options.signal);
    const archive = bytes[0] === 0x50 && bytes[1] === 0x4b
      ? await readArchive(bytes, limits, options.signal)
      : { documents: [bytes], skippedArtifacts: 0 };
    if (archive.documents.reduce((sum, bytes) => sum + bytes.byteLength, 0) > limits.maxExtractedBytes) {
      throw new RecordError('LIMIT_EXCEEDED');
    }
    const budget = { textLength: 0, warnings: new Set<string>() };
    const records: unknown[] = [];
    for (const bytes of archive.documents) {
      await yieldTurn();
      checkCancellation(options.signal);
      const document = parseDocument(bytes, limits, budget);
      if (document.length > limits.maxConversations - records.length) throw new RecordError('LIMIT_EXCEEDED');
      for (const record of document) records.push(record);
    }
    const providers = new Set<Provider>();
    for (const record of records) {
      await yieldTurn();
      checkCancellation(options.signal);
      for (const candidate of providerCandidates(record, limits)) {
        providers.add(candidate);
      }
      if (providers.size > 1) throw new RecordError('AMBIGUOUS_PROVIDER');
    }
    const provider = providers.values().next().value;
    if (!provider) throw new RecordError('UNSUPPORTED_FORMAT');
    if (options.provider !== undefined && options.provider !== provider) throw new RecordError('PROVIDER_MISMATCH');
    let messageCount = 0;
    for (const record of records) {
      if (!object(record)) continue;
      if (provider === 'chatgpt' && object(record.mapping)) messageCount += Object.keys(record.mapping).length;
      if (provider === 'claude' && Array.isArray(record.chat_messages)) messageCount += record.chat_messages.length;
      if (messageCount > limits.maxMessages) throw new RecordError('LIMIT_EXCEEDED');
    }
    result.provider = provider;
    result.format = provider === 'chatgpt' ? 'chatgpt-mapping' : 'claude-chat-messages';
    const parser = provider === 'chatgpt' ? parseChatGPT : parseClaude;
    const groups = new Map<string, { index: number; parsed: ParsedConversation; canonical: ImportedConversation }[]>();
    const malformedIds = new Set<string>();
    for (const [index, record] of records.entries()) {
      await yieldTurn();
      checkCancellation(options.signal);
      try {
        const parsed = parser(record, limits);
        const group = groups.get(parsed.sourceId) ?? [];
        group.push({ index, parsed, canonical: canonical(provider, parsed) });
        groups.set(parsed.sourceId, group);
      } catch (error) {
        if (!(error instanceof RecordError)) throw error;
        if (error.code === 'LIMIT_EXCEEDED') throw error;
        result.rejections.push(diagnostic(error.code, index));
        if (object(record)) {
          const aliases = provider === 'claude' ? [record.uuid] : [record.id, record.conversation_id];
          for (const alias of aliases) {
            try {
              malformedIds.add(sourceId(alias));
            } catch { /* An invalid ID cannot collide with an accepted source identity. */ }
          }
        }
      }
    }
    result.counts.skippedArtifacts = archive.skippedArtifacts;
    if (archive.skippedArtifacts) budget.warnings.add('UNSUPPORTED_ARTIFACT');
    for (const [source, group] of groups) {
      const versions = group.map(item => JSON.stringify([
        item.canonical.revision, item.parsed.skippedArtifacts, [...item.parsed.warnings].sort(),
      ]));
      if (malformedIds.has(source) || new Set(versions).size > 1) {
        for (const item of group) result.rejections.push(diagnostic('DUPLICATE_CONVERSATION_ID', item.index));
        continue;
      }
      const first = group[0];
      result.conversations.push(first.canonical);
      result.counts.skippedArtifacts += first.parsed.skippedArtifacts;
      for (const code of first.parsed.warnings) result.warnings.push(diagnostic(code, first.index));
      if (group.length > 1) budget.warnings.add('DUPLICATE_CONVERSATION');
    }
    checkCancellation(options.signal);
    result.conversations.sort((a, b) => a.id.localeCompare(b.id));
    result.rejections.sort((a, b) => (a.recordIndex ?? -1) - (b.recordIndex ?? -1));
    result.warnings.push(...[...budget.warnings].sort().map(code => diagnostic(code)));
    result.counts.conversations = result.conversations.length;
    result.counts.messages = result.conversations.reduce((count, chat) => count + chat.messages.length, 0);
    result.counts.rejectedRecords = result.rejections.length;
    result.status = result.conversations.length ? 'ready' : 'rejected';
    return result;
  } catch (error) {
    if (!(error instanceof RecordError) && !(error instanceof ArchiveError)) throw error;
    return {
      ...emptyResult(), importId: result.importId, status: error.code === 'CANCELLED' ? 'cancelled' : 'rejected',
      rejections: [diagnostic(error.code)],
    };
  }
}
