import type {
  CandidateFact,
  ExtractionInput,
  MemoryUpdate,
} from '../../src/shared/domain';
export const MAX_EXTRACTION_BYTES = 24 * 1024;
export const MAX_OUTPUT_BYTES = 24 * 1024;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
export const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
export const scopeKey = (scope: CandidateFact['scope']) =>
  scope.kind === 'global'
    ? 'global'
    : scope.projectId === null
      ? 'project:general'
      : `project:id:${scope.projectId}`;
export const identityKey = (
  fact: Pick<CandidateFact, 'scope' | 'subject' | 'key'>,
) =>
  JSON.stringify([
    scopeKey(fact.scope),
    normalize(fact.subject),
    normalize(fact.key),
  ]);
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && bytes(value) <= max;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new Error('Unexpected extraction field');
}
/** Conservative lexical grounding: exact user quotes, literal values, or explicit adoption of a prior complete proposal. */
export function validateUpdate(
  raw: unknown,
  input: ExtractionInput,
): MemoryUpdate {
  if (!object(raw)) throw new Error('Invalid extraction output');
  keys(raw, ['summary', 'facts']);
  if (
    typeof raw.summary !== 'string' ||
    bytes(raw.summary) > 4096 ||
    !Array.isArray(raw.facts) ||
    raw.facts.length > 32 ||
    bytes(JSON.stringify(raw)) > MAX_OUTPUT_BYTES
  )
    throw new Error('Oversized or malformed extraction');
  const facts = raw.facts.map((rawFact): CandidateFact => {
    if (!object(rawFact)) throw new Error('Invalid fact');
    keys(rawFact, [
      'scope',
      'subject',
      'key',
      'value',
      'keywords',
      'sourceMessageIds',
      'evidence',
      'kind',
    ]);
    const f = rawFact;
    if (
      !object(f.scope) ||
      !['global', 'project'].includes(String(f.scope.kind))
    )
      throw new Error('Invalid scope');
    keys(f.scope, f.scope.kind === 'global' ? ['kind'] : ['kind', 'projectId']);
    if (
      f.scope.kind === 'project' &&
      f.scope.projectId !== input.snapshot.chat.projectId
    )
      throw new Error('Scope ownership mismatch');
    if (
      !text(f.subject, 128) ||
      !text(f.key, 128) ||
      !text(f.value, 2048) ||
      !['assertion', 'correction'].includes(String(f.kind))
    )
      throw new Error('Invalid fact fields');
    if (
      !Array.isArray(f.keywords) ||
      f.keywords.length > 16 ||
      f.keywords.some((k) => !text(k, 64))
    )
      throw new Error('Invalid keywords');
    if (
      !Array.isArray(f.sourceMessageIds) ||
      f.sourceMessageIds.length === 0 ||
      f.sourceMessageIds.length > 8 ||
      f.sourceMessageIds.some((id) => !text(id, 128)) ||
      new Set(f.sourceMessageIds).size !== f.sourceMessageIds.length
    )
      throw new Error('Invalid sources');
    if (
      !Array.isArray(f.evidence) ||
      f.evidence.length !== f.sourceMessageIds.length
    )
      throw new Error('Invalid evidence');
    const candidate = f as unknown as CandidateFact;
    const seen = new Set<string>();
    for (const evidence of candidate.evidence) {
      if (
        !object(evidence) ||
        !text(evidence.messageId, 128) ||
        !text(evidence.quote, 4096) ||
        !candidate.sourceMessageIds.includes(evidence.messageId) ||
        seen.has(evidence.messageId)
      )
        throw new Error('Invalid evidence');
      keys(evidence, ['messageId', 'quote']);
      seen.add(evidence.messageId);
      const index = input.snapshot.messages.findIndex(
          (m) => m.id === evidence.messageId,
        ),
        message = input.snapshot.messages[index];
      if (
        !message ||
        message.chatId !== input.snapshot.chat.id ||
        message.role !== 'user' ||
        message.sourceSequence === null ||
        message.sourceSequence <= input.afterSequence ||
        message.sourceSequence > input.throughSequence ||
        !message.content.includes(evidence.quote)
      )
        throw new Error('Invalid user source');
      // Quoted/copied material is not a direct assertion. Conservatively reject the whole message.
      if (
        /```|^\s*>|\b(?:document|article|transcript|quoted text|someone)\s+(?:says|said|reads)|\b(?:quote|unquote)\b/im.test(
          message.content,
        ) ||
        /^["“]/.test(evidence.quote.trim())
      )
        throw new Error('Quoted text is not evidence');
      const value = normalize(candidate.value),
        quote = normalize(evidence.quote);
      const adoption =
        /^(?:yes[,.!]?\s*)?(?:agreed|i agree|i accept|let'?s use|use that|go with that|adopt)(?:\b|$)/i.test(
          quote,
        ) && !/\b(?:not|never|reject|disagree|don'?t|no)\b/i.test(quote);
      const previous = input.snapshot.messages
        .slice(0, index)
        .reverse()
        .find((m) => m.role === 'assistant');
      const complete =
        previous &&
        input.snapshot.runs.some(
          (r) => r.assistantMessageId === previous.id && r.state === 'complete',
        );
      if (
        !quote.includes(value) &&
        !(adoption && complete && normalize(previous!.content).includes(value))
      )
        throw new Error('Value lacks user evidence');
      if (
        candidate.kind === 'correction' &&
        !/\b(?:actually|instead|change|switch|correction|no longer|replace|now use)\b/i.test(
          quote,
        )
      )
        throw new Error('Correction lacks explicit evidence');
    }
    return {
      ...candidate,
      scope: { ...candidate.scope },
      subject: normalize(candidate.subject),
      key: normalize(candidate.key),
      value: candidate.value.trim(),
      keywords: [...new Set(candidate.keywords.map(normalize))],
      sourceMessageIds: [...candidate.sourceMessageIds],
      evidence: candidate.evidence.map((e) => ({ ...e })),
    };
  });
  return { summary: raw.summary, facts };
}
