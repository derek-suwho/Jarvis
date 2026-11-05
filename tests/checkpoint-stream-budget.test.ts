import { afterEach, expect, it, vi } from 'vitest';
import type { Chat } from '../src/shared/chatTypes';
import type { TaskSnapshot, TasksBridge } from '../src/shared/tasks';
const harness = vi.hoisted(() => ({ refs: [] as any[], cursor: 0, effects: [] as Array<() => void>, save: vi.fn(async () => {}) }));
vi.mock('react', () => ({
  useRef: (value: unknown) => harness.refs[harness.cursor++] ?? (harness.refs[harness.cursor - 1] = { current: value }),
  useEffect: (effect: () => void) => { harness.effects.push(effect); },
}));
vi.mock('../src/lib/chats', () => ({ saveChats: harness.save }));
import { useChatCheckpoint } from '../src/lib/useChatCheckpoint';
afterEach(() => { vi.useRealTimers(); harness.refs = []; harness.effects = []; vi.clearAllMocks(); });

it('saves user changes and each completed task but does not checkpoint streaming tokens on a timer', async () => {
  vi.useFakeTimers();
  const ack = vi.fn(async () => {});
  const client = { bridge: { ack } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [{ id: 'answer', role: 'assistant', content: '', taskRevision: 1 }] }];
  let tasks = [{ id: 'task', revision: 1, state: 'running', target: { id: 'chat', ephemeral: false }, messages: [{ id: 'answer' }] },
    { id: 'other', revision: 1, state: 'running', target: { id: 'other', ephemeral: false }, messages: [] }] as TaskSnapshot[];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, tasks, true, pause.current, client, pause);
    // Run the persistence effect for this render.
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  expect(harness.save).toHaveBeenCalledTimes(1);
  harness.save.mockClear(); ack.mockClear();
  for (let revision = 2; revision <= 8; revision++) {
    chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], content: 'token '.repeat(revision), taskRevision: revision }] }];
    tasks = [{ ...tasks[0], revision }, tasks[1]];
    await render();
    await vi.advanceTimersByTimeAsync(300);
  }
  expect(harness.save).not.toHaveBeenCalled();
  expect(ack).not.toHaveBeenCalled();
  tasks = [{ ...tasks[0], state: 'complete' }, tasks[1]];
  await render();
  expect(harness.save).toHaveBeenCalledExactlyOnceWith(chats);
  expect(ack).toHaveBeenCalledWith({ taskId: 'task', revision: 8 });
  // Projection can land one render after the terminal task snapshot.
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], content: 'Final projected answer' }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  chats = [{ ...chats[0], title: 'Renamed while other task runs' }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
  pause.current = true;
  chats = [];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
});


it('retries an unchanged checkpoint after a failed durable write without acknowledging the failed save', async () => {
  const ack = vi.fn(async () => {});
  const client = { bridge: { ack } as unknown as TasksBridge };
  const pause = { current: false };
  const chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Final answer', taskRevision: 2 },
  ] }];
  const tasks = [{ id: 'task', revision: 2, state: 'complete', target: { id: 'chat', ephemeral: false },
    messages: [{ id: 'answer' }] }] as TaskSnapshot[];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint([...chats], tasks, true, false, client, pause);
    harness.effects[0]();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  harness.save.mockRejectedValueOnce(new Error('disk temporarily unavailable'));
  await render();
  expect(harness.save).toHaveBeenCalledTimes(1);
  expect(ack).not.toHaveBeenCalled();
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(ack).toHaveBeenCalledExactlyOnceWith({ taskId: 'task', revision: 2 });
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
});

it('checkpoints attachment replacement and removal without saving equivalent attachment snapshots', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  const file = { id: 'file', name: 'private.txt', type: 'text/plain', size: 7, text: 'private' };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'user', role: 'user', content: 'Inspect', attachments: [file] },
  ] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], attachments: [{ ...file }] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(1);
  // Same metadata and byte length, different payload: content must invalidate.
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], attachments: [{ ...file, text: 'revised' }] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], attachments: [] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
});

it('persists changed tool results without rewriting equivalent tool snapshots', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  const tool = { id: 'call', server: 'local', tool: 'search', status: 'running' as const };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Searching', tools: [tool] },
  ] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], tools: [{ ...tool }] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(1);
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], tools: [{ ...tool, status: 'done', detail: 'Found results' }] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
});

it('defers active tool progress archive writes until the durable task completes', async () => {
  const ack = vi.fn(async () => {});
  const client = { bridge: { ack } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Searching', taskRevision: 1 },
  ] }];
  let tasks = [{ id: 'task', revision: 1, state: 'running', target: { id: 'chat', ephemeral: false },
    messages: [{ id: 'answer' }] }] as TaskSnapshot[];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, tasks, true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  harness.save.mockClear(); ack.mockClear();
  for (let revision = 2; revision <= 8; revision++) {
    chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], taskRevision: revision,
      tools: [{ id: 'call', server: 'local', tool: 'search', status: 'running', detail: `Progress ${revision}` }],
    }] }];
    tasks = [{ ...tasks[0], revision }];
    await render();
  }
  expect(harness.save).not.toHaveBeenCalled();
  expect(ack).not.toHaveBeenCalled();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0],
    tools: [{ id: 'call', server: 'local', tool: 'search', status: 'done', detail: 'Final result' }],
  }] }];
  tasks = [{ ...tasks[0], state: 'complete' }];
  await render();
  expect(harness.save).toHaveBeenCalledExactlyOnceWith(chats);
  expect(ack).toHaveBeenCalledExactlyOnceWith({ taskId: 'task', revision: 8 });
});

it('persists error-only reply changes so restart preserves context exclusion', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Partial reply' },
  ] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], error: true }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
});

it('persists a generation-only change so restart keeps the task fence', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', taskGeneration: 'old', updatedAt: 1, messages: [] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], taskGeneration: 'new' }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
});

it('persists identical-text retry provenance and terminal revision changes', async () => {
  const ack = vi.fn(async () => {});
  const client = { bridge: { ack } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Same answer', taskId: 'old', attemptId: 'old-attempt', taskRevision: 1 },
  ] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], taskId: 'retry', attemptId: 'retry-attempt', taskRevision: 2 }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], taskRevision: 3 }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
});

it('avoids archive writes for temporary activity while persisting transitions across the retention boundary', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [
    { id: 'durable', title: 'History', updatedAt: 1, messages: [] },
    { id: 'private', title: 'Temporary', temporary: true, updatedAt: 1, messages: [] },
  ];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [chats[0], { ...chats[1], title: 'Private activity', messages: [
    { id: 'user', role: 'user', content: 'Inspect', attachments: [
      { id: 'media', name: 'private.txt', type: 'text/plain', size: 7, text: 'private' },
    ] },
  ] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(1);
  chats = [chats[0], { ...chats[1], temporary: false }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  chats = [chats[0], { ...chats[1], temporary: true }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  chats = [chats[0]];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(3);
});

it('persists corrected model attribution without rewriting equivalent snapshots', async () => {
  const client = { bridge: { ack: vi.fn(async () => {}) } as unknown as TasksBridge };
  const pause = { current: false };
  let chats: Chat[] = [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', content: 'Answer', model: 'ChatGPT' },
  ] }];
  const render = async () => {
    harness.cursor = 0; harness.effects = [];
    useChatCheckpoint(chats, [], true, false, client, pause);
    harness.effects[0]();
    await Promise.resolve(); await Promise.resolve();
  };
  await render();
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0], model: 'Claude' }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
  expect(harness.save).toHaveBeenLastCalledWith(chats);
  chats = [{ ...chats[0], messages: [{ ...chats[0].messages[0] }] }];
  await render();
  expect(harness.save).toHaveBeenCalledTimes(2);
});
