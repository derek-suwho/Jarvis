import { describe, expect, it } from 'vitest';
import * as subscriptions from '../src/lib/subscriptions';

describe('account plan labels', () => {
  it('displays recognized ChatGPT tiers from account metadata', () => {
    expect(subscriptions.chatGPTPlanLabel).toBeTypeOf('function');
    for (const [value, label] of [['free', 'Free'], ['plus', 'Plus'], ['prolite', 'Pro'], ['pro', 'Pro (More)'], ['promax', 'Pro (Max)'], ['business', 'Business'], ['team', 'Team']]) {
      expect(subscriptions.chatGPTPlanLabel(value)).toBe(label);
    }
  });

  it('does not invent a tier for missing or unsupported metadata', () => {
    expect(subscriptions.chatGPTPlanLabel).toBeTypeOf('function');
    for (const value of [null, undefined, '', 'future-tier', {}, '<script>']) {
      expect(subscriptions.chatGPTPlanLabel(value)).toBe('Plan unavailable');
    }
  });
});
