import { describe, expect, it } from 'vitest';
import type { Message } from '../src/lib/chats';
import {
  canGoBack,
  canGoForward,
  createBrowserTab,
  createSideChat,
  currentUrl,
  goBack,
  goForward,
  mockSideReply,
  navigate,
  normalizeUrl,
  tabTitle,
  updateSideChat,
} from '../src/lib/tabs';

describe('normalizeUrl', () => {
  it('keeps http(s) URLs and adds https to bare domains', () => {
    expect(normalizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeUrl('wikipedia.org')).toBe('https://wikipedia.org/');
    expect(normalizeUrl('en.wikipedia.org/wiki/Cat')).toBe('https://en.wikipedia.org/wiki/Cat');
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173/');
  });

  it('turns free text into a search', () => {
    expect(normalizeUrl('best pizza')).toBe('https://duckduckgo.com/?q=best%20pizza');
  });

  it('rejects unsafe schemes and empty input', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});

describe('browser history', () => {
  it('navigates, goes back to the new-tab page, and drops forward history on visit', () => {
    let b = createBrowserTab();
    if (b.kind !== 'browser') throw new Error('expected browser');
    let s = navigate(b.browser, 'https://a.com/');
    s = navigate(s, 'https://b.com/');
    expect(currentUrl(s)).toBe('https://b.com/');
    s = goBack(goBack(s));
    expect(currentUrl(s)).toBeNull();
    expect(canGoBack(s)).toBe(false);
    s = goForward(s);
    expect(currentUrl(s)).toBe('https://a.com/');
    s = navigate(s, 'https://c.com/');
    expect(canGoForward(s)).toBe(false);
    expect(s.history).toEqual(['https://a.com/', 'https://c.com/']);
    expect(tabTitle({ ...b, browser: s })).toBe('c.com');
  });
});

describe('side chat', () => {
  const msg = (id: string, content: string): Message => ({ id, role: 'user', content });

  it('snapshots context so later main-chat messages do not leak in', () => {
    const source = { title: 'Trip', messages: [msg('1', 'plan a trip')] };
    const tab = createSideChat(source);
    source.messages.push(msg('2', 'later message'));
    if (tab.kind !== 'sidechat') throw new Error('expected sidechat');
    expect(tab.sidechat.context.map((m) => m.id)).toEqual(['1']);
    expect(mockSideReply('why?', 'Claude', tab.sidechat)).toContain('1 message of context from "Trip"');
  });

  it('updates only the targeted side chat', () => {
    const a = createSideChat(null);
    const b = createBrowserTab();
    const tabs = updateSideChat([a, b], a.id, (s) => ({ ...s, messages: [msg('x', 'hi')] }));
    expect(tabs[0].kind === 'sidechat' && tabs[0].sidechat.messages).toHaveLength(1);
    expect(tabs[1]).toBe(b);
  });
});
