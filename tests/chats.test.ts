import { describe, expect, it } from 'vitest';
import type { Chat } from '../src/lib/chats';
import { appendMessage, createChat, filterChats, sortByRecent, titleFrom } from '../src/lib/chats';

describe('titleFrom', () => {
  it('collapses whitespace and truncates long text', () => {
    expect(titleFrom('  hello   world ')).toBe('hello world');
    expect(titleFrom('a'.repeat(60))).toBe(`${'a'.repeat(40)}…`);
  });

  it('falls back for empty input', () => {
    expect(titleFrom('   ')).toBe('New chat');
  });
});

describe('appendMessage', () => {
  it('names the chat from the first user message only', () => {
    const chat = createChat(0);
    let chats = appendMessage([chat], chat.id, { id: '1', role: 'user', content: 'Plan a trip' }, 5);
    chats = appendMessage(chats, chat.id, { id: '2', role: 'user', content: 'Something else' }, 6);
    expect(chats[0].title).toBe('Plan a trip');
    expect(chats[0].messages).toHaveLength(2);
    expect(chats[0].updatedAt).toBe(6);
  });

  it('leaves other chats untouched', () => {
    const a = createChat(0);
    const b = createChat(0);
    const chats = appendMessage([a, b], a.id, { id: '1', role: 'user', content: 'hi' });
    expect(chats[1]).toBe(b);
  });
});

describe('sortByRecent / filterChats', () => {
  const chats: Chat[] = [
    { id: 'old', title: 'Old', messages: [], updatedAt: 1 },
    { id: 'new', title: 'New', messages: [{ id: 'm', role: 'user', content: 'budget sheet' }], updatedAt: 2 },
  ];

  it('orders newest first without mutating input', () => {
    expect(sortByRecent(chats).map((c) => c.id)).toEqual(['new', 'old']);
    expect(chats[0].id).toBe('old');
  });

  it('matches title or message content, case-insensitive', () => {
    expect(filterChats(chats, 'BUDGET').map((c) => c.id)).toEqual(['new']);
    expect(filterChats(chats, 'old').map((c) => c.id)).toEqual(['old']);
    expect(filterChats(chats, '  ')).toHaveLength(2);
  });
});
