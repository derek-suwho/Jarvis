import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatGPTStatusLine } from '../src/components/ChatGPTAccount';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';

const chatgpt = (plan?: string | null) => ({
  state: { phase: 'connected', email: 'alex@example.invalid', plan },
}) as ChatGPTAccount;

describe('account-reported plan display', () => {
  it('renders the ChatGPT plan as account metadata', () => {
    const html = renderToStaticMarkup(createElement(ChatGPTStatusLine, { account: chatgpt('plus') }));
    expect(html).toContain('Plus');
    expect(html).toContain('alex@example.invalid');
  });

  it('shows unknown plan explicitly without guessing a paid or free tier', () => {
    for (const value of [undefined, null, '']) {
      const html = renderToStaticMarkup(createElement(ChatGPTStatusLine, { account: chatgpt(value) }));
      expect(html).toContain('Plan unavailable');
      expect(html).not.toContain('Free');
    }
  });

});
