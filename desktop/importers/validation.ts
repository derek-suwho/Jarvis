import type { ImportLimits } from './types';

export class RecordError extends Error {
  constructor(readonly code: string) {
    super('The export record could not be safely imported.');
  }
}

export function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    || ['__proto__', 'constructor', 'prototype'].includes(value)) {
    throw new RecordError('INVALID_ID');
  }
  return value;
}

export function timestamp(value: unknown, format: 'unix' | 'iso'): string | null {
  if (value === undefined || value === null) return null;
  let milliseconds: number;
  if (format === 'unix') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 253402300799.999) {
      throw new RecordError('INVALID_TIMESTAMP');
    }
    milliseconds = Math.round(value * 1000);
  } else {
    const match = typeof value === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
      : null;
    if (!match) throw new RecordError('INVALID_TIMESTAMP');
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
    const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
      || hour > 23 || minute > 59 || second > 59
      || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
      throw new RecordError('INVALID_TIMESTAMP');
    }
    milliseconds = Date.parse(value as string);
  }
  if (!Number.isFinite(milliseconds) || milliseconds < -62135596800000 || milliseconds > 253402300799999) {
    throw new RecordError('INVALID_TIMESTAMP');
  }
  return new Date(milliseconds).toISOString();
}

export function boundedText(value: unknown, limits: Pick<ImportLimits, 'maxTextLength'>): string {
  if (typeof value !== 'string') throw new RecordError('INVALID_CONTENT');
  if (value.length > limits.maxTextLength) throw new RecordError('LIMIT_EXCEEDED');
  return value;
}
