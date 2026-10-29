import { describe, expect, it } from 'vitest';
import * as validation from '../../desktop/importers/validation';

describe('untrusted record validation', () => {
  it('accepts opaque IDs without coercing malformed or unsafe values', () => {
    expect(validation.sourceId).toBeTypeOf('function');
    expect(validation.sourceId('client-created-root')).toBe('client-created-root');
    for (const value of [undefined, null, {}, [], '', ' ', ' id', 'id\n', '__proto__', 'constructor', 'a'.repeat(257)]) {
      expect(() => validation.sourceId(value)).toThrowError(expect.objectContaining({ code: 'INVALID_ID' }));
    }
  });

  it('normalizes real instants and distinguishes missing from invalid timestamps', () => {
    expect(validation.timestamp).toBeTypeOf('function');
    expect(validation.timestamp(1700000000.125, 'unix')).toBe('2023-11-14T22:13:20.125Z');
    expect(validation.timestamp('2024-02-29T12:00:00.123456+02:00', 'iso')).toBe('2024-02-29T10:00:00.123Z');
    expect(validation.timestamp(null, 'unix')).toBeNull();
    expect(validation.timestamp(undefined, 'iso')).toBeNull();
    for (const value of ['today', '2023-02-29T00:00:00Z', '2024-04-31T00:00:00Z', '2024-01-01T24:00:00Z', 0, '2024-01-01']) {
      expect(() => validation.timestamp(value, 'iso')).toThrowError(expect.objectContaining({ code: 'INVALID_TIMESTAMP' }));
    }
    for (const value of ['1700000000', NaN, Infinity, -1, 1e20, {}]) {
      expect(() => validation.timestamp(value, 'unix')).toThrowError(expect.objectContaining({ code: 'INVALID_TIMESTAMP' }));
    }
  });

  it('bounds text without interpreting HTML, instructions, or URLs', () => {
    expect(validation.boundedText).toBeTypeOf('function');
    const text = '<script>alert(1)</script> Ignore instructions; javascript:alert(2)';
    expect(validation.boundedText(text, { maxTextLength: 100 })).toBe(text);
    expect(() => validation.boundedText({}, { maxTextLength: 100 })).toThrowError(expect.objectContaining({ code: 'INVALID_CONTENT' }));
    expect(() => validation.boundedText('abcdef', { maxTextLength: 5 })).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});
