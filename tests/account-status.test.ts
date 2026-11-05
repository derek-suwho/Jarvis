import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatGPTStatusLine } from '../src/components/ChatGPTAccount';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';
import { ClaudeStatusLine } from '../src/components/ClaudeAccount';
import { SubscriptionStatusLine } from '../src/components/SubscriptionAccount';
import type { ClaudeAccount } from '../src/lib/useClaude';
import type { SubscriptionAccount } from '../src/lib/useSubscriptionAccount';

function status(state: ChatGPTAccount['state']) {
  return renderToStaticMarkup(createElement(ChatGPTStatusLine, { account: { state } as ChatGPTAccount }));
}

describe('ChatGPT account status presentation', () => {
  it.each([
    ['loading', 'Checking connection…'],
    ['signing-in', 'Waiting for browser sign-in…'],
    ['unavailable', 'Desktop app required'],
  ] as const)('announces %s without claiming the account is disconnected', (phase, message) => {
    const html = status({ phase });
    expect(html).toContain(message);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Not connected');
  });

  it('announces authentication failures and escapes provider error text', () => {
    const html = status({ phase: 'signed-out', registered: false, error: '<Sign-in failed>' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;Sign-in failed&gt;');
  });

  it('preserves the connected identity and signed-out status', () => {
    expect(status({ phase: 'connected', email: 'person@example.com' })).toContain('person@example.com');
    expect(status({ phase: 'signed-out', registered: false })).toContain('Not connected');
  });
});


describe('Claude account status presentation', () => {
  function render(state: ClaudeAccount['state']) {
    return renderToStaticMarkup(createElement(ClaudeStatusLine, { account: { state } as ClaudeAccount }));
  }
  it.each([
    [{ phase: 'loading' }, 'Checking connection…'],
    [{ phase: 'unavailable' }, 'Desktop app required'],
    [{ phase: 'signed-out', waiting: true }, 'Waiting for Terminal sign-in…'],
  ] as const)('announces pending or unavailable state %j', (state, message) => {
    const html = render(state);
    expect(html).toContain(message);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Not connected');
  });
  it('announces an escaped authentication error', () => {
    const html = render({ phase: 'signed-out', waiting: false, error: '<Login failed>' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;Login failed&gt;');
  });
});

describe('Gemini and Grok shared account status presentation', () => {
  it.each([
    [{ phase: 'loading' }, 'Checking connection'],
    [{ phase: 'unavailable' }, 'Desktop app required'],
    [{ phase: 'signed-out', signingIn: true }, 'Waiting for sign-in'],
  ] as const)('announces pending or unavailable state %j', (state, message) => {
    const html = renderToStaticMarkup(createElement(SubscriptionStatusLine, { account: { state } as SubscriptionAccount }));
    expect(html).toContain(message);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Not connected');
  });
});
