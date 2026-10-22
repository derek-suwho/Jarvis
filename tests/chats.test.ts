import { describe, expect, it } from 'vitest';
import type { Chat } from '../src/lib/chats';
import {
  appendMessage,
  createChat,
  filterChats,
  groupChats,
  renameChat,
  sortByRecent,
  titleFrom,
  togglePin,
  truncateFrom,
  chatToMarkdown,
  recentChats,
  streamChunks,
  updateMessage,
} from '../src/lib/chats';

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

describe('renameChat / togglePin', () => {
  const chats: Chat[] = [{ id: 'a', title: 'A', messages: [], updatedAt: 0 }];

  it('renames with trimmed text and ignores blank titles', () => {
    expect(renameChat(chats, 'a', '  Trip  ')[0].title).toBe('Trip');
    expect(renameChat(chats, 'a', '   ')).toBe(chats);
  });

  it('toggles pinned state', () => {
    const pinned = togglePin(chats, 'a');
    expect(pinned[0].pinned).toBe(true);
    expect(togglePin(pinned, 'a')[0].pinned).toBe(false);
  });
});

describe('truncateFrom', () => {
  const chats: Chat[] = [
    {
      id: 'c',
      title: 'C',
      messages: [
        { id: '1', role: 'user', content: 'a' },
        { id: '2', role: 'assistant', content: 'b' },
        { id: '3', role: 'user', content: 'c' },
      ],
      updatedAt: 0,
    },
  ];

  it('drops the message and everything after it', () => {
    expect(truncateFrom(chats, 'c', '2')[0].messages.map((m) => m.id)).toEqual(['1']);
  });

  it('leaves the chat unchanged for an unknown message', () => {
    expect(truncateFrom(chats, 'c', 'x')[0]).toBe(chats[0]);
  });
});

describe('groupChats', () => {
  const now = new Date(2026, 9, 21, 15).getTime();
  const day = 86_400_000;
  const at = (id: string, updatedAt: number, pinned = false): Chat => ({ id, title: id, messages: [], updatedAt, pinned });

  it('buckets by recency with pinned first and drops empty groups', () => {
    const groups = groupChats(
      [at('today', now - 1000), at('yday', now - day), at('week', now - 3 * day), at('old', now - 90 * day), at('pin', 0, true)],
      now,
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['today']],
      ['Yesterday', ['yday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']],
    ]);
  });
});

describe('recentChats', () => {
  it('hides temporary, archived and project chats', () => {
    const base = { title: 't', messages: [], updatedAt: 0 };
    const chats: Chat[] = [
      { ...base, id: 'keep' },
      { ...base, id: 'tmp', temporary: true },
      { ...base, id: 'arch', archived: true },
      { ...base, id: 'proj', projectId: 'p' },
    ];
    expect(recentChats(chats).map((c) => c.id)).toEqual(['keep']);
  });
});

describe('updateMessage', () => {
  it('patches one message in one chat', () => {
    const chats: Chat[] = [{ id: 'c', title: 'C', messages: [{ id: 'm', role: 'assistant', content: 'x' }], updatedAt: 0 }];
    expect(updateMessage(chats, 'c', 'm', { feedback: 'up' })[0].messages[0]).toEqual({
      id: 'm',
      role: 'assistant',
      content: 'x',
      feedback: 'up',
    });
  });
});

describe('streamChunks', () => {
  it('rebuilds the original text exactly', () => {
    const text = 'Hello there,\n\nthis is  a reply.';
    const chunks = streamChunks(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('chatToMarkdown', () => {
  it('labels speakers and lists attachments', () => {
    const chat: Chat = {
      id: 'c',
      title: 'Trip',
      updatedAt: 0,
      messages: [
        { id: '1', role: 'user', content: 'Plan it', attachments: [{ id: 'a', name: 'map.png', size: 1, type: 'image/png' }] },
        { id: '2', role: 'assistant', content: 'Sure', model: 'Claude' },
      ],
    };
    const md = chatToMarkdown(chat);
    expect(md).toContain('# Trip');
    expect(md).toContain('**You:**\n\nPlan it');
    expect(md).toContain('_Attached: map.png_');
    expect(md).toContain('**Claude:**\n\nSure');
  });
});
