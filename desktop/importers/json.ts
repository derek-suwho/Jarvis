import type { ImportLimits } from './types';
import { RecordError } from './validation';

export interface JsonBudget { textLength: number; warnings: Set<string> }
interface Frame { object: boolean; keys: Set<string>; expectingKey: boolean }
const sensitiveKeys = new Set([
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'apikey', 'secret', 'clientsecret',
  'cookie', 'cookies', 'authorization', 'auth', 'authentication', 'credentials',
  'password', 'sessiontoken', 'sessionid',
]);

/** Bound nesting and strings BEFORE JSON.parse; reject ambiguous duplicate keys. */
export function parseDocument(bytes: Uint8Array, limits: ImportLimits, budget: JsonBudget): unknown[] {
  if (bytes.byteLength > limits.maxFileBytes) throw new RecordError('LIMIT_EXCEEDED');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RecordError('INVALID_ENCODING');
  }
  const frames: Frame[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '{' || character === '[') {
      frames.push({ object: character === '{', keys: new Set(), expectingKey: true });
      if (frames.length > limits.maxJsonDepth) throw new RecordError('LIMIT_EXCEEDED');
    } else if (character === '}' || character === ']') {
      frames.pop();
    } else if (character === ',') {
      const frame = frames.at(-1);
      if (frame?.object) frame.expectingKey = true;
    } else if (character === '"') {
      const start = index;
      for (index++; index < text.length; index++) {
        if (text[index] === '\\') index++;
        else if (text[index] === '"') break;
      }
      if (index >= text.length) throw new RecordError('INVALID_JSON');
      let value: string;
      try {
        value = JSON.parse(text.slice(start, index + 1)) as string;
      } catch {
        throw new RecordError('INVALID_JSON');
      }
      budget.textLength += value.length;
      if (value.length > limits.maxTextLength || budget.textLength > limits.maxTotalTextLength) {
        throw new RecordError('LIMIT_EXCEEDED');
      }
      const frame = frames.at(-1);
      if (frame?.object && frame.expectingKey) {
        if (frame.keys.has(value)) throw new RecordError('DUPLICATE_JSON_KEY');
        frame.keys.add(value);
        frame.expectingKey = false;
        if (sensitiveKeys.has(value.toLowerCase().replace(/[_-]/g, ''))) budget.warnings.add('SENSITIVE_METADATA_IGNORED');
      } else if (/(?:javascript|vbscript|data|file|shell|command):/i.test(value)) {
        budget.warnings.add('UNSAFE_URL');
      }
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecordError('INVALID_JSON');
  }
  if (!Array.isArray(parsed)) throw new RecordError('INVALID_WRAPPER');
  return parsed;
}
