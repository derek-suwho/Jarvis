import { describe, expect, it } from 'vitest';
import { resolveProfileName } from '../src/lib/profile';

describe('profile display name', () => {
  it('preserves the user-selected name over connected identities', () => {
    expect(resolveProfileName('  Alex  ', { name: 'Alex Example', email: 'alex@example.com' })).toBe('Alex');
  });

  it('uses a provider name before another provider email', () => {
    expect(resolveProfileName(' ', { email: 'a@example.com' }, { name: '  Alex Example  ' })).toBe('Alex Example');
  });

  it('falls back to the actual email without guessing a human name', () => {
    expect(resolveProfileName('', null, { name: ' ', email: '  a.example123@example.com  ' })).toBe('a.example123@example.com');
  });

  it('uses Account only when no identity is available', () => {
    expect(resolveProfileName('', undefined, null, { name: '', email: null })).toBe('Account');
  });
});
