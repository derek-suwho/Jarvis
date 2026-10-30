import type { ParsedConversation } from './adapter-types';
import type { ImportLimits } from './types';
import { boundedText, RecordError, sourceId, timestamp } from './validation';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseClaude(value: unknown, limits: ImportLimits): ParsedConversation {
  if (!object(value) || !Array.isArray(value.chat_messages)) throw new RecordError('INVALID_RECORD');
  if (value.chat_messages.length > limits.maxMessages) throw new RecordError('LIMIT_EXCEEDED');
  const record = value;
  const ids = new Set<string>();
  const warnings = new Set<string>();
  let skippedArtifacts = 0;

  function date(value: unknown): string | null {
    const result = timestamp(value, 'iso');
    if (result === null) warnings.add('MISSING_TIMESTAMP');
    return result;
  }

  function skipCollection(value: unknown): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new RecordError('INVALID_CONTENT');
    if (value.length) {
      skippedArtifacts += value.length;
      warnings.add('UNSUPPORTED_CONTENT');
    }
  }

  const createdAt = date(record.created_at);
  const updatedAt = date(record.updated_at);
  const messages = value.chat_messages.map(message => {
    if (!object(message)) throw new RecordError('INVALID_MESSAGE');
    const id = sourceId(message.uuid);
    if (ids.has(id)) throw new RecordError('DUPLICATE_MESSAGE_ID');
    ids.add(id);
    if (message.sender !== 'human' && message.sender !== 'assistant') throw new RecordError('INVALID_ROLE');
    timestamp(message.updated_at, 'iso');
    skipCollection(message.attachments);
    skipCollection(message.files);

    const parts: string[] = [];
    if (message.content !== undefined && !Array.isArray(message.content)) throw new RecordError('INVALID_CONTENT');
    const content = message.content as unknown[] | undefined;
    if (!content?.length) {
      parts.push(boundedText(message.text, limits));
    } else {
      for (const block of content) {
        if (!object(block) || typeof block.type !== 'string' || !block.type.trim()) throw new RecordError('INVALID_CONTENT');
        if (block.type === 'text') {
          parts.push(boundedText(block.text, limits));
          if (block.citations !== null) skipCollection(block.citations);
        } else {
          skippedArtifacts++;
          warnings.add('UNSUPPORTED_CONTENT');
        }
      }
    }
    return {
      sourceId: id,
      role: message.sender === 'human' ? 'user' as const : 'assistant' as const,
      createdAt: date(message.created_at),
      parts,
    };
  });

  return {
    sourceId: sourceId(record.uuid),
    title: boundedText(record.name, limits),
    createdAt,
    updatedAt,
    quality: warnings.size ? 'partial' : 'structured',
    messages,
    warnings: [...warnings],
    skippedArtifacts,
  };
}
