import type { Message } from './chats';
import { newId, titleFrom } from './chats';

/** `index` -1 means the new-tab page; history holds visited URLs. */
export interface BrowserState {
  history: string[];
  index: number;
  reloadKey: number;
}

/**
 * A temporary chat: `context` is a snapshot of the main conversation taken when
 * the side chat opened, so later main-chat messages never reach it. Nothing is
 * persisted — closing the tab discards it.
 */
export interface SideChatState {
  sourceTitle: string | null;
  /** Project scope is frozen with the source conversation. */
  projectInstructions?: string;
  context: Message[];
  messages: Message[];
}

export type Tab =
  | { id: string; kind: 'browser'; browser: BrowserState }
  | { id: string; kind: 'sidechat'; sidechat: SideChatState };

const SEARCH_URL = 'https://www.google.com/search?q=';

export function createBrowserTab(): Tab {
  return { id: newId(), kind: 'browser', browser: { history: [], index: -1, reloadKey: 0 } };
}

export function createSideChat(
  source: { title: string; messages: Message[] } | null,
  projectInstructions?: string,
): Tab {
  return {
    id: newId(),
    kind: 'sidechat',
    sidechat: {
      sourceTitle: source?.title ?? null,
      context: source ? [...source.messages] : [],
      messages: [],
      ...(projectInstructions ? { projectInstructions } : {}),
    },
  };
}

export function currentUrl(b: BrowserState): string | null {
  return b.index >= 0 ? b.history[b.index] : null;
}

export function tabTitle(tab: Tab): string {
  if (tab.kind === 'sidechat') return 'Side chat';
  const url = currentUrl(tab.browser);
  if (!url) return 'New tab';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Turns address-bar input into a safe http(s) URL: explicit URLs are kept,
 * bare domains get https://, anything else becomes a search. Other schemes
 * (javascript:, file:, data:) are rejected.
 */
export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  // "host:port" is not a scheme, so a colon followed by a digit falls through to host handling.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) {
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }
  const looksLikeHost =
    !/\s/.test(text) && (/^[^/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(text) || /^localhost(:\d+)?(\/.*)?$/i.test(text));
  if (looksLikeHost) {
    const scheme = text.startsWith('localhost') ? 'http://' : 'https://';
    try {
      return new URL(scheme + text).href;
    } catch {
      return null;
    }
  }
  return SEARCH_URL + encodeURIComponent(text);
}

/** Visiting a page drops any forward history, like a real browser. */
export function navigate(b: BrowserState, url: string): BrowserState {
  return { ...b, history: [...b.history.slice(0, b.index + 1), url], index: b.index + 1 };
}

/** Redirects (google.com -> www.google.com) update the current entry instead of adding one. */
export function replaceCurrent(b: BrowserState, url: string): BrowserState {
  if (b.index < 0) return navigate(b, url);
  const history = [...b.history];
  history[b.index] = url;
  return { ...b, history };
}

export const canGoBack = (b: BrowserState) => b.index >= 0;
export const canGoForward = (b: BrowserState) => b.index < b.history.length - 1;

export function goBack(b: BrowserState): BrowserState {
  return canGoBack(b) ? { ...b, index: b.index - 1 } : b;
}

export function goForward(b: BrowserState): BrowserState {
  return canGoForward(b) ? { ...b, index: b.index + 1 } : b;
}

export function reload(b: BrowserState): BrowserState {
  return { ...b, reloadKey: b.reloadKey + 1 };
}

export function updateSideChat(tabs: Tab[], id: string, fn: (s: SideChatState) => SideChatState): Tab[] {
  return tabs.map((t) => (t.id === id && t.kind === 'sidechat' ? { ...t, sidechat: fn(t.sidechat) } : t));
}

/** Placeholder until provider adapters exist; shows what context the side chat would send. */
export function mockSideReply(prompt: string, model: string, s: SideChatState): string {
  const ctx = s.sourceTitle
    ? `${s.context.length} message${s.context.length === 1 ? '' : 's'} of context from "${s.sourceTitle}"`
    : 'no conversation context';
  return `(${model} side chat placeholder, ${ctx}) You asked: "${titleFrom(prompt)}"`;
}
