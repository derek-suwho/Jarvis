import { describe, expect, it } from 'vitest';
import { sanitizeSubscriptions, setPlan } from '../src/lib/subscriptions';

describe('subscriptions', () => {
  it('drops unknown providers and plans from stored data', () => {
    expect(sanitizeSubscriptions({ openai: 'Plus', anthropic: 'Ultra Mega', nope: 'Pro' })).toEqual({ openai: 'Plus' });
    expect(sanitizeSubscriptions('garbage')).toEqual({});
    expect(sanitizeSubscriptions(null)).toEqual({});
  });

  it('adds, changes, and removes a plan', () => {
    let s = setPlan({}, 'anthropic', 'Max 5x');
    expect(s).toEqual({ anthropic: 'Max 5x' });
    s = setPlan(s, 'anthropic', 'Pro');
    expect(s).toEqual({ anthropic: 'Pro' });
    expect(setPlan(s, 'anthropic', null)).toEqual({});
  });
});
