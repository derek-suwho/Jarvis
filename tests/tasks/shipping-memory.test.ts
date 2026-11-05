import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDesktopStorage } from '../../desktop/runtime';
const { createTaskCoordinator } = createRequire(import.meta.url)('../../electron/tasks/coordinator.cjs');

it('deletes original-project evidence after a chat moves and fences late extraction', async () => {
  const storage = openDesktopStorage(':memory:');
  try {
    const turn = (id: string, projectId: string) => {
      const run = storage.beginShippingTurn({ requestId: id, chatId: 'moved-chat',
        text: `Use ${id}`, model: { providerId: 'claude', modelId: 'origin' } },
        { id: projectId, name: projectId });
      storage.runs.appendDelta(run.id, `Answer ${id}`);
      storage.runs.finish(run.id, 'complete');
      return { run, job: storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)! };
    };
    const first = turn('blue', 'design');
    const update = { summary: 'Private design summary', facts: [{
      scope: { kind: 'global' as const }, subject: 'user', key: 'color', value: 'blue',
      keywords: ['color'], kind: 'assertion' as const, sourceMessageIds: [first.run.userMessageId],
      evidence: [{ messageId: first.run.userMessageId, quote: 'Use blue' }],
    }] };
    storage.memory.apply(first.job.id, update);
    const pending = turn('green', 'design');
    const kept = turn('red', 'engineering');
    expect(storage.memory.list()).toHaveLength(1);
    storage.projects.delete('design');
    expect(storage.memory.extractionInput(pending.job.id)).toBeNull();
    expect(storage.memory.jobs().map(job => job.id)).toEqual([kept.job.id]);
    expect(storage.chats.get('moved-chat')?.messages.map(message => message.content))
      .toEqual(['Use red', 'Answer red']);
    expect(storage.chats.get('moved-chat')?.chat.title).toBe('New chat');
    expect(storage.memory.getSummary('moved-chat')).toBeNull();
    expect(storage.memory.list()).toEqual([]);
    expect(() => storage.memory.apply(pending.job.id, update)).not.toThrow();
    expect(storage.memory.list()).toEqual([]);
    expect(storage.chats.get('moved-chat')?.chat.projectId).toBe('engineering');
  } finally {
    await storage.close();
  }
});

it('isolates extraction evidence and summaries when a shipping chat changes projects', async () => {
  const storage = openDesktopStorage(':memory:');
  try {
    const turn = (id: string, projectId: string) => {
      const run = storage.beginShippingTurn({ requestId: id, chatId: 'moving-chat',
        text: `Preference for ${projectId}`, model: { providerId: 'claude', modelId: 'origin' } },
        { id: projectId, name: projectId });
      storage.runs.appendDelta(run.id, `Proposal for ${projectId}`);
      storage.runs.finish(run.id, 'complete');
      return storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
    };
    const first = turn('first', 'design');
    storage.memory.apply(first.id, { summary: 'Design private context', facts: [] });
    const same = turn('same', 'design');
    expect(storage.memory.extractionInput(same.id)?.previousSummary).toBe('Design private context');
    storage.memory.apply(same.id, { summary: 'More design context', facts: [] });
    const other = turn('other', 'engineering');
    const input = storage.memory.extractionInput(other.id)!;
    expect(input.snapshot.messages.map(message => message.content))
      .toEqual(['Preference for engineering', 'Proposal for engineering']);
    expect(input.previousSummary).toBeNull();
    storage.memory.apply(other.id, { summary: 'Engineering private context', facts: [] });
    const back = turn('back', 'design');
    const returned = storage.memory.extractionInput(back.id)!;
    expect(returned.previousSummary).toBeNull();
    expect(returned.snapshot.messages.map(message => message.content))
      .toEqual(['Preference for design', 'Proposal for design', 'Preference for design',
        'Proposal for design', 'Preference for design', 'Proposal for design']);
  } finally {
    await storage.close();
  }
});

it('preserves queued extraction scope through shipping project moves, removal, and restart', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.shipping-scope-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const turn = (project: { id: string; name: string } | null) => {
      const run = storage.beginShippingTurn({ requestId: crypto.randomUUID(), chatId: 'moving-chat',
        text: 'Use blue', model: { providerId: 'claude', modelId: 'origin' } }, project);
      storage.runs.finish(run.id, 'complete');
      return run;
    };
    const first = turn({ id: 'design', name: 'Design' });
    turn({ id: 'engineering', name: 'Engineering' });
    turn(null);
    await storage.close();
    storage = openDesktopStorage(path);
    const jobs = storage.memory.jobs();
    expect(storage.chats.get('moving-chat')?.chat.projectId).toBeNull();
    expect(jobs.map(job => storage.memory.extractionInput(job.id)?.snapshot.chat.projectId))
      .toEqual(['design', 'engineering', null]);
    expect(storage.memory.pendingEvidence({ chatId: 'other', projectId: 'design', text: '' })
      .map(e => e.projectId)).toEqual(['design']);
    storage.memory.apply(jobs[0].id, { summary: 'Color choice', facts: [{
      scope: { kind: 'project', projectId: 'design' }, subject: 'palette', key: 'color',
      value: 'blue', keywords: ['color'], kind: 'assertion',
      sourceMessageIds: [first.userMessageId],
      evidence: [{ messageId: first.userMessageId, quote: 'Use blue' }],
    }] });
    expect(storage.memory.list()[0].scope).toEqual({ kind: 'project', projectId: 'design' });
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('persists shipping turns and completion jobs across restart while excluding ephemeral chats and cancelled extraction', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.shipping-memory-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  let settle: (value: any) => void = () => {};
  let receive: (value: any) => void = () => {};
  const coordinator = createTaskCoordinator({
    storage,
    openAttempt: (_input: any, emit: any) => {
      receive = emit;
      return { settled: new Promise(resolve => { settle = resolve; }), stop() { settle({ kind: 'complete' }); } };
    },
  });
  const start = (requestId: string, ephemeral = false) => coordinator.start({
    requestId, target: { kind: 'chat', id: 'shipping-chat', generation: 'one', ephemeral },
    provider: 'claude', model: 'origin', title: 'Preference', modelLabel: 'Claude', instructions: '',
    history: [], input: { id: requestId, role: 'user', content: 'I prefer concise answers' },
  }, 1);
  try {
    const first = await start('first');
    expect(first.ok).toBe(true);
    expect(storage.chats.get('shipping-chat')?.messages.map(m => m.content)).toEqual(['I prefer concise answers', '']);
    receive({ type: 'delta', text: 'Understood' });
    settle({ kind: 'complete' });
    await expect.poll(() => storage.memory.jobs().length).toBe(1);
    expect(storage.runs.list('shipping-chat')[0].state).toBe('complete');
    const second = await start('second');
    receive({ type: 'delta', text: 'Partial' });
    await coordinator.stop(second.task.id);
    await expect.poll(() => storage.runs.list('shipping-chat')[1]?.state).toBe('cancelled');
    expect(storage.memory.jobs()).toHaveLength(1);
    await start('private', true);
    settle({ kind: 'complete' });
    await expect.poll(() => coordinator.snapshot().find((t: any) => t.requestId === 'private')?.state).toBe('complete');
    expect(storage.runs.list('shipping-chat')).toHaveLength(2);
    await storage.close();
    storage = openDesktopStorage(path);
    expect(storage.chats.get('shipping-chat')?.messages.map(m => m.content)).toEqual([
      'I prefer concise answers', 'Understood', 'I prefer concise answers', 'Partial',
    ]);
    expect(storage.memory.jobs()).toHaveLength(1);
    await createTaskCoordinator({ storage }).forgetTarget({ kind: 'chat', id: 'shipping-chat', generation: 'one', ephemeral: false });
    expect(storage.chats.get('shipping-chat')).toBeNull();
    expect(storage.memory.jobs()).toEqual([]);
  } finally {
    coordinator.shutdown();
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('recovers a shipping run interrupted by restart without scheduling extraction', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.shipping-restart-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  try {
    const run = storage.beginShippingTurn({ requestId: 'crashed', chatId: 'shipping',
      text: 'Remember my preference', model: { providerId: 'gemini', modelId: 'origin' } });
    storage.runs.appendDelta(run.id, 'Partial');
    await storage.close();
    storage = openDesktopStorage(path);
    expect(storage.runs.get(run.id)?.state).toBe('interrupted');
    expect(storage.memory.jobs()).toEqual([]);
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('persists shutdown interruption before closing storage and fences slow provider settlement', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.shipping-shutdown-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  let settle: (value: any) => void = () => {};
  let receive: (value: any) => void = () => {};
  let stopped = false;
  const coordinator = createTaskCoordinator({ storage, openAttempt: (_input: any, emit: any) => {
    receive = emit;
    return { settled: new Promise(resolve => { settle = resolve; }), stop() { stopped = true; } };
  } });
  try {
    const started = await coordinator.start({
      requestId: 'slow-shutdown', target: { kind: 'chat', id: 'slow-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Preference', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'input', role: 'user', content: 'I prefer concise answers' },
    }, 1);
    expect(started.ok).toBe(true);
    receive({ type: 'delta', text: 'Partial response' });
    coordinator.shutdown();
    expect(stopped).toBe(true);
    expect(storage.runs.list('slow-chat')[0].state).toBe('interrupted');
    expect(storage.memory.jobs()).toEqual([]);
    await storage.close();
    receive({ type: 'delta', text: ' late output' });
    settle({ kind: 'complete' });
    await expect.poll(() => coordinator.snapshot()[0].state).toBe('interrupted');
    storage = openDesktopStorage(path);
    expect(storage.runs.list('slow-chat')[0].state).toBe('interrupted');
    expect(storage.chats.get('slow-chat')?.messages.map(m => m.content)).toEqual([
      'I prefer concise answers', 'Partial response',
    ]);
    expect(storage.memory.jobs()).toEqual([]);
  } finally {
    coordinator.shutdown();
    settle({ kind: 'complete' });
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('persists attachment-only text turns as extraction evidence without importing history or instructions', async () => {
  const storage = openDesktopStorage(':memory:');
  let settle: (value: any) => void = () => {};
  const coordinator = createTaskCoordinator({ storage, openAttempt: () => ({
    settled: new Promise(resolve => { settle = resolve; }), stop() { settle({ kind: 'interrupted' }); },
  }) });
  try {
    const result = await coordinator.start({
      requestId: 'attachment-only', target: { kind: 'chat', id: 'files-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Preference', modelLabel: 'Claude',
      instructions: 'Private instructions excluded from evidence',
      history: [{ id: 'old', role: 'user', content: 'Old history excluded from evidence' }],
      input: { id: 'file-input', role: 'user', content: '', attachments: [
        { id: 'file', name: 'preferences.txt', type: 'text/plain', size: 24, text: 'I prefer concise answers' },
      ] },
    }, 1);
    expect(result.ok).toBe(true);
    const saved = storage.chats.get('files-chat');
    expect(saved?.messages[0].content).toBe('\n\n--- Attached file: "preferences.txt" ---\nI prefer concise answers\n--- End attached file ---');
    settle({ kind: 'complete' });
    await expect.poll(() => storage.memory.jobs().length).toBe(1);
    const evidence = storage.memory.extractionInput(storage.memory.jobs()[0].id);
    expect(evidence?.snapshot.messages[0].content).toBe(saved?.messages[0].content);
    expect(JSON.stringify(evidence)).not.toContain('excluded from evidence');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('carries shipping project scope into durable extraction evidence', async () => {
  const storage = openDesktopStorage(':memory:');
  let settle: (value: any) => void = () => {};
  const coordinator = createTaskCoordinator({ storage, openAttempt: () => ({
    settled: new Promise(resolve => { settle = resolve; }), stop() { settle({ kind: 'interrupted' }); },
  }) });
  try {
    const result = await coordinator.start({
      requestId: 'project-turn', target: { kind: 'chat', id: 'project-chat', generation: 'one', ephemeral: false },
      project: { id: 'project-one', name: 'Design' },
      provider: 'claude', model: 'origin', title: 'Preference', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'input', role: 'user', content: 'Use blue for this project' },
    }, 1);
    expect(result.ok).toBe(true);
    expect(storage.chats.get('project-chat')?.chat.projectId).toBe('project-one');
    settle({ kind: 'complete' });
    await expect.poll(() => storage.memory.jobs().length).toBe(1);
    expect(storage.memory.extractionInput(storage.memory.jobs()[0].id)?.snapshot.chat.projectId).toBe('project-one');
    expect(storage.projects.get('project-one')?.name).toBe('Design');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('delivers relevant global memory across shipping chats/providers without recapturing it as user evidence', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    const seed = (key: string, value: string, scope: { kind: 'global' } | { kind: 'project'; projectId: null }) => {
      const run = storage.beginShippingTurn({ requestId: key, chatId: `seed-${key}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } }, null);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{ scope, subject: 'user', key, value,
        keywords: [key.includes('database') ? 'database' : key], kind: 'assertion', sourceMessageIds: [run.userMessageId],
        evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
      return storage.memory.list().find(fact => fact.key === key)!;
    };
    seed('database', 'SQLite', { kind: 'global' });
    seed('private_database', 'PrivateDB', { kind: 'project', projectId: null });
    storage.memory.forget(seed('forgotten_database', 'ForgottenDB', { kind: 'global' }).id);
    seed('unrelated', 'UnrelatedValue', { kind: 'global' });
    // Higher-ranked private matches must not consume the global retrieval limit.
    for (let i = 0; i < 101; i++) {
      seed(`private_database_${i}`, 'database database database', { kind: 'project', projectId: null });
    }
    const started = await coordinator.start({ requestId: 'recall-global',
      target: { kind: 'chat', id: 'recall-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'recall-input', role: 'user', content: 'Which database should I use?' },
    }, 1);
    expect(started.ok).toBe(true);
    const sent = JSON.stringify(captured[0].request.messages);
    expect(sent).toContain('SQLite');
    expect(sent).not.toContain('PrivateDB');
    expect(sent).not.toContain('database database database');
    expect(sent).not.toContain('ForgottenDB');
    expect(sent).not.toContain('UnrelatedValue');
    expect(storage.chats.get('recall-chat')?.messages[0].content).toBe('Which database should I use?');
    await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('recalls global memory from an attachment-only question without persisting injected facts', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    const seed = (key: string, value: string, scope: { kind: 'global' } | { kind: 'project'; projectId: null }) => {
      const run = storage.beginShippingTurn({ requestId: key, chatId: `seed-${key}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } }, null);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{ scope, subject: 'user', key, value,
        keywords: [key.includes('database') ? 'database' : key], kind: 'assertion', sourceMessageIds: [run.userMessageId],
        evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
      return storage.memory.list().find(fact => fact.key === key)!;
    };
    seed('database', 'SQLite', { kind: 'global' });
    seed('private_database', 'PrivateDB', { kind: 'project', projectId: null });
    storage.memory.forget(seed('forgotten_database', 'ForgottenDB', { kind: 'global' }).id);
    seed('unrelated', 'UnrelatedValue', { kind: 'global' });
    const started = await coordinator.start({ requestId: 'recall-global',
      target: { kind: 'chat', id: 'recall-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'recall-input', role: 'user', content: '', attachments: [
        { id: 'question', name: 'question.txt', type: 'text/plain', size: 29, text: 'Which database should I use?' },
      ] },
    }, 1);
    expect(started.ok).toBe(true);
    const sent = JSON.stringify(captured[0].request.messages);
    expect(sent).toContain('SQLite');
    expect(sent).not.toContain('PrivateDB');
    expect(sent).not.toContain('database database database');
    expect(sent).not.toContain('ForgottenDB');
    expect(sent).not.toContain('UnrelatedValue');
    expect(storage.chats.get('recall-chat')?.messages[0].content).toContain('Which database should I use?');
    expect(storage.chats.get('recall-chat')?.messages[0].content).not.toContain('SQLite');
    await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('recalls current-project and global facts while excluding other projects from shipping requests', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    for (const [key, value, projectId] of [
      ['global_database', 'SQLite', null],
      ['design_database', 'DesignDB', 'design'],
      ['engineering_database', 'PrivateEngineeringDB', 'engineering'],
    ] as const) {
      const run = storage.beginShippingTurn({ requestId: key, chatId: `seed-${key}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } },
        projectId ? { id: projectId, name: projectId } : null);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{
        scope: projectId ? { kind: 'project', projectId } : { kind: 'global' },
        subject: 'user', key, value, keywords: ['database'], kind: 'assertion',
        sourceMessageIds: [run.userMessageId], evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
    }
    const started = await coordinator.start({ requestId: 'recall-project',
      target: { kind: 'chat', id: 'design-chat', generation: 'one', ephemeral: false },
      project: { id: 'design', name: 'Design' },
      provider: 'gemini', model: 'origin', title: 'Recall', modelLabel: 'Gemini', instructions: '',
      history: [], input: { id: 'project-input', role: 'user', content: 'Which database should I use?' },
    }, 1);
    expect(started.ok).toBe(true);
    const sent = JSON.stringify(captured[0].request.messages);
    expect(sent).toContain('DesignDB');
    expect(sent).toContain('SQLite');
    expect(sent).not.toContain('PrivateEngineeringDB');
    expect(storage.chats.get('design-chat')?.messages[0].content).toBe('Which database should I use?');
    await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});


it('recalls explicitly named projects and unique aliases without guessing ambiguous or partial names', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    for (const [name, aliases, value] of [
      ['Design Studio', ['Palette', 'Shared'], 'DesignDB'],
      ['Engineering', ['Engine', 'Shared'], 'EngineeringDB'],
      ['Market', [], 'PrivateMarketDB'],
    ] as [string, string[], string][]) {
      const project = storage.projects.create(name, aliases);
      const run = storage.beginShippingTurn({ requestId: project.id, chatId: `seed-${project.id}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } }, project);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{
        scope: { kind: 'project', projectId: project.id }, subject: 'user', key: 'database', value,
        keywords: ['database'], kind: 'assertion', sourceMessageIds: [run.userMessageId],
        evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
    }
    for (const [query, included] of [
      ['Compare database choices for DESIGN STUDIO and Engine.', ['DesignDB', 'EngineeringDB']],
      ['Which database does Palette use?', ['DesignDB']],
      ['Which databases does Palette use?', ['DesignDB']],
      ['Ｗｈｉｃｈ ｄａｔａｂａｓｅ ｄｏｅｓ Ｐａｌｅｔｔｅ ｕｓｅ？', ['DesignDB']],
      ['Compare database choices across all projects.', ['DesignDB', 'EngineeringDB', 'PrivateMarketDB']],
      ['Which database supports all projectiles?', []],
      ['Which database does Shared use?', []],
      ['Which database supports marketing?', []],
    ] as [string, string[]][]) {
      const requestId = crypto.randomUUID();
      const result = await coordinator.start({ requestId,
        target: { kind: 'chat', id: requestId, generation: 'one', ephemeral: false },
        provider: 'grok', model: 'origin', title: 'Recall', modelLabel: 'Grok', instructions: '',
        history: [], input: { id: requestId, role: 'user', content: query },
      }, 1);
      expect(result.ok).toBe(true);
      await expect.poll(() => coordinator.snapshot().find((task: any) => task.requestId === requestId)?.state).toBe('complete');
      const sent = JSON.stringify(captured.at(-1).request.messages);
      for (const value of ['DesignDB', 'EngineeringDB', 'PrivateMarketDB']) {
        if (included.includes(value)) {
          expect(sent).toContain(value);
          expect(captured.at(-1).request.messages.at(-1).content).toContain('projectId');
        }
        else expect(sent).not.toContain(value);
      }
      if (query.includes('Shared')) {
        expect(sent).toContain('Ask the user which project they mean before answering project-specific memory questions.');
      } else {
        expect(sent).not.toContain('Ask the user which project they mean');
      }
      expect(storage.chats.get(requestId)?.messages[0].content).toBe(query);
    }
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('waits for pending extraction before shipping recall and cancels waiting dispatch safely', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = openDesktopStorage(':memory:', { getAdapter: providerId => ({
    id: providerId, connect: async () => {}, disconnect: async () => {},
    status: async () => 'connected', listModels: async () => [],
    async *stream(request) {
      const input = JSON.parse(request.context.messages[0].content);
      const message = input.messages.find((m: any) => m.role === 'user');
      await gate;
      yield { type: 'delta', text: JSON.stringify({ summary: '', facts: [{
        scope: { kind: 'global' }, subject: 'user', key: 'database', value: 'SQLite',
        keywords: ['database'], kind: 'assertion', sourceMessageIds: [message.id],
        evidence: [{ messageId: message.id, quote: 'Use SQLite' }],
      }] }) };
      yield { type: 'done' };
    },
  }) });
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  const start = (requestId: string) => coordinator.start({ requestId,
    target: { kind: 'chat', id: requestId, generation: 'one', ephemeral: false },
    provider: 'gemini', model: 'origin', title: 'Recall', modelLabel: 'Gemini', instructions: '',
    history: [], input: { id: requestId, role: 'user', content: 'Which database should I use?' },
  }, 1);
  try {
    const run = storage.beginShippingTurn({ requestId: 'seed-pending', chatId: 'seed-pending',
      text: 'Use SQLite', model: { providerId: 'claude', modelId: 'origin' } });
    storage.runs.finish(run.id, 'complete');
    const cancelled = await start('cancelled-recall');
    expect(captured).toHaveLength(0);
    await coordinator.stop(cancelled.task.id);
    const active = await start('pending-recall');
    expect(captured).toHaveLength(0);
    release();
    await expect.poll(() => coordinator.snapshot().find((t: any) => t.id === active.task.id)?.state).toBe('complete');
    expect(captured).toHaveLength(1);
    expect(JSON.stringify(captured[0].request.messages)).toContain('SQLite');
    expect(coordinator.snapshot().find((t: any) => t.id === cancelled.task.id)?.state).toBe('cancelled');
  } finally {
    release();
    coordinator.shutdown();
    await storage.close();
  }
});

it('refreshes scoped memory in continuation updates without persisting injected evidence', async () => {
  const storage = openDesktopStorage(':memory:');
  const attempts: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    let finish: (value: any) => void = () => {};
    const settled = new Promise(resolve => { finish = resolve; });
    attempts.push({ input, finish });
    return { settled, stop() { finish({ kind: 'interrupted' }); } };
  } });
  try {
    const started = await coordinator.start({ requestId: 'refresh',
      target: { kind: 'chat', id: 'refresh-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'initial', role: 'user', content: 'Hello' },
    }, 1);
    await expect.poll(() => attempts.length).toBe(1);
    const run = storage.beginShippingTurn({ requestId: 'fresh-seed', chatId: 'fresh-seed',
      text: 'Use SQLite', model: { providerId: 'gemini', modelId: 'origin' } });
    storage.runs.finish(run.id, 'complete');
    const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
    storage.memory.apply(job.id, { summary: '', facts: [{ scope: { kind: 'global' },
      subject: 'user', key: 'database', value: 'SQLite', keywords: ['database'], kind: 'assertion',
      sourceMessageIds: [run.userMessageId], evidence: [{ messageId: run.userMessageId, quote: 'Use SQLite' }],
    }] });
    await coordinator.queue({ taskId: started.task.id, entryId: 'followup',
      message: { id: 'followup', role: 'user', content: 'Which database should I use?' } });
    attempts[0].finish({ kind: 'complete', continuation: { saved: true } });
    await expect.poll(() => attempts.length).toBe(2);
    expect(JSON.stringify(attempts[1].input.updates)).toContain('SQLite');
    expect(attempts[1].input.continuation).toEqual({ saved: true });
    expect(storage.chats.get('refresh-chat')?.messages.filter(m => m.role === 'user').map(m => m.content))
      .toEqual(['Hello', 'Which database should I use?']);
    attempts[1].finish({ kind: 'complete' });
    await expect.poll(() => coordinator.snapshot()[0].state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('discloses incomplete memory after a bounded drain on initial and continuation dispatch', async () => {
  const storage = openDesktopStorage(':memory:');
  const attempts: any[] = [];
  const coordinator = createTaskCoordinator({
    storage: { ...storage, drainForContext: async () => ({ updating: true }) },
    openAttempt: (input: any) => {
      let finish: (value: any) => void = () => {};
      const settled = new Promise(resolve => { finish = resolve; });
      attempts.push({ input, finish });
      return { settled, stop() { finish({ kind: 'interrupted' }); } };
    },
  });
  try {
    const started = await coordinator.start({ requestId: 'updating',
      target: { kind: 'chat', id: 'updating-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'initial', role: 'user', content: 'Which database?' },
    }, 1);
    await expect.poll(() => attempts.length).toBe(1);
    expect(attempts[0].input.request.messages.at(-1).content).toContain('Memory is still updating');
    await coordinator.queue({ taskId: started.task.id, entryId: 'followup',
      message: { id: 'followup', role: 'user', content: 'Any preference?' } });
    attempts[0].finish({ kind: 'complete', continuation: { saved: true } });
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1].input.updates.at(-1).content).toContain('Memory is still updating');
    expect(storage.chats.get('updating-chat')?.messages.filter(m => m.role === 'user').map(m => m.content))
      .toEqual(['Which database?', 'Any preference?']);
    attempts[1].finish({ kind: 'complete' });
    await expect.poll(() => coordinator.snapshot()[0].state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});

it('bounds shipping recall to four global facts while retaining relevant project memory', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    for (let i = 0; i < 14; i++) {
      const project = i >= 6 ? { id: 'design', name: 'Design' } : null;
      const value = `DatabaseChoice${i}`;
      const run = storage.beginShippingTurn({ requestId: `seed-bound-${i}`, chatId: `seed-bound-${i}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } }, project);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{
        scope: project ? { kind: 'project', projectId: project.id } : { kind: 'global' },
        subject: 'user', key: `database_${i}`, value, keywords: ['database'], kind: 'assertion',
        sourceMessageIds: [run.userMessageId], evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
    }
    const prompt = 'Which database should I use?';
    const result = await coordinator.start({ requestId: 'bounded-recall',
      target: { kind: 'chat', id: 'bounded-recall', generation: 'one', ephemeral: false },
      project: { id: 'design', name: 'Design' },
      provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
      history: [], input: { id: 'bounded-input', role: 'user', content: prompt },
    }, 1);
    expect(result.ok).toBe(true);
    const content = captured[0].request.messages.at(-1).content as string;
    const facts = JSON.parse(content.split('authorization):\n')[1].split('\n\nCurrent user message:')[0]);
    expect(facts.filter((fact: any) => fact.scope.kind === 'global')).toHaveLength(4);
    expect(facts.filter((fact: any) => fact.scope.kind === 'project')).toHaveLength(4);
    expect(facts).toHaveLength(8);
    expect(Buffer.byteLength(content.slice(0, content.indexOf(prompt)))).toBeLessThanOrEqual(8192);
    expect(storage.chats.get('bounded-recall')?.messages[0].content).toBe(prompt);
    await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});


it('retains both explicitly compared projects when either has enough matches to fill the context', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    for (const project of [{ id: 'design', name: 'Design' }, { id: 'engineering', name: 'Engineering' }]) {
      for (let i = 0; i < 8; i++) {
        const id = `${project.id}-${i}`;
        const value = `${project.name}DB${i}`;
        const run = storage.beginShippingTurn({ requestId: id, chatId: id, text: `Use ${value}`,
          model: { providerId: 'chatgpt', modelId: 'origin' } }, project);
        storage.runs.finish(run.id, 'complete');
        const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
        storage.memory.apply(job.id, { summary: '', facts: [{
          scope: { kind: 'project', projectId: project.id }, subject: 'user', key: `database_${i}`, value,
          keywords: ['database'], kind: 'assertion', sourceMessageIds: [run.userMessageId],
          evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
        }] });
      }
    }
    const query = 'Compare database choices for Design and Engineering.';
    const result = await coordinator.start({ requestId: 'crowded-comparison',
      target: { kind: 'chat', id: 'comparison', generation: 'one', ephemeral: false },
      provider: 'grok', model: 'origin', title: 'Compare', modelLabel: 'Grok', instructions: '',
      history: [], input: { id: 'comparison-input', role: 'user', content: query },
    }, 1);
    expect(result.ok).toBe(true);
    await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
    const content = captured[0].request.messages.at(-1).content;
    const facts = JSON.parse(content.split('authorization):\n')[1].split('\n\nCurrent user message:')[0]);
    expect(facts).toHaveLength(8);
    expect(facts.filter((fact: any) => fact.scope.projectId === 'design')).toHaveLength(4);
    expect(facts.filter((fact: any) => fact.scope.projectId === 'engineering')).toHaveLength(4);
    expect(Buffer.byteLength(content.slice(0, -query.length))).toBeLessThanOrEqual(8192);
    expect(storage.chats.get('comparison')?.messages[0].content).toBe(query);
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});


it('resolves a longer explicit project name without recalling its shorter-name neighbour', async () => {
  const storage = openDesktopStorage(':memory:');
  const captured: any[] = [];
  const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
    captured.push(input);
    return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
  } });
  try {
    for (const [name, value] of [['Market', 'PrivateMarketDB'], ['Market Research', 'ResearchDB']]) {
      const project = storage.projects.create(name, []);
      const run = storage.beginShippingTurn({ requestId: project.id, chatId: `seed-${project.id}`,
        text: `Use ${value}`, model: { providerId: 'chatgpt', modelId: 'origin' } }, project);
      storage.runs.finish(run.id, 'complete');
      const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
      storage.memory.apply(job.id, { summary: '', facts: [{
        scope: { kind: 'project', projectId: project.id }, subject: 'user', key: 'database', value,
        keywords: ['database'], kind: 'assertion', sourceMessageIds: [run.userMessageId],
        evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
      }] });
    }
    for (const [query, includesMarket] of [
      ['Which database does Market Research use?', false],
      ['Compare database choices for Market Research and Market.', true],
    ] as const) {
      const requestId = crypto.randomUUID();
      const result = await coordinator.start({ requestId,
        target: { kind: 'chat', id: requestId, generation: 'one', ephemeral: false },
        provider: 'claude', model: 'origin', title: 'Recall', modelLabel: 'Claude', instructions: '',
        history: [], input: { id: requestId, role: 'user', content: query },
      }, 1);
      expect(result.ok).toBe(true);
      await expect.poll(() => coordinator.snapshot().find((task: any) => task.requestId === requestId)?.state).toBe('complete');
      const sent = JSON.stringify(captured.at(-1).request.messages);
      expect(sent).toContain('ResearchDB');
      if (includesMarket) expect(sent).toContain('PrivateMarketDB');
      else expect(sent).not.toContain('PrivateMarketDB');
      expect(storage.chats.get(requestId)?.messages[0].content).toBe(query);
    }
  } finally {
    coordinator.shutdown();
    await storage.close();
  }
});


it('deletes failed original-project turns after a chat moves, including their archived messages', async () => {
  const storage = openDesktopStorage(':memory:');
  try {
    const privateRun = storage.beginShippingTurn({ requestId: 'private-failed', chatId: 'moved',
      text: 'Private failed input', model: { providerId: 'claude', modelId: 'origin' } },
      { id: 'private', name: 'Private' });
    storage.runs.appendDelta(privateRun.id, 'Private partial answer');
    storage.runs.finish(privateRun.id, 'failed');
    const safeRun = storage.beginShippingTurn({ requestId: 'safe', chatId: 'moved',
      text: 'Keep this', model: privateRun.model }, { id: 'kept', name: 'Kept' });
    storage.runs.finish(safeRun.id, 'complete');
    storage.checkpoints.save([{ id: 'moved', projectId: 'kept', title: 'Private failed input', updatedAt: 1,
      messages: [
        { id: privateRun.userMessageId, role: 'user', content: 'Private failed input', attemptId: 'private-failed' },
        { id: privateRun.assistantMessageId, role: 'assistant', content: 'Private partial answer', attemptId: 'private-failed' },
        { id: safeRun.userMessageId, role: 'user', content: 'Keep this', attemptId: 'safe' },
      ] }]);
    expect(storage.memory.jobs()).toHaveLength(1);
    await storage.projects.delete('private');
    expect(storage.runs.get(privateRun.id)).toBeNull();
    expect(storage.chats.get('moved')?.messages.map(message => message.content)).toEqual(['Keep this', '']);
    expect(storage.checkpoints.load()).toMatchObject([{ title: 'New chat', messages: [{ content: 'Keep this' }] }]);
    expect(storage.checkpoints.load()![0].messages).toHaveLength(1);
    expect(storage.runs.get(safeRun.id)).not.toBeNull();
    expect(storage.memory.jobs()).toHaveLength(1);
  } finally {
    await storage.close();
  }
});


it('purges moved-project checkpoint evidence without optional attempt metadata', async () => {
  const storage = openDesktopStorage(':memory:');
  try {
    const privateRun = storage.beginShippingTurn({ requestId: 'private-legacy', chatId: 'legacy-moved',
      text: 'Private legacy input', model: { providerId: 'claude', modelId: 'origin' } },
      { id: 'private', name: 'Private' });
    storage.runs.finish(privateRun.id, 'failed');
    const kept = storage.beginShippingTurn({ requestId: 'kept-legacy', chatId: 'legacy-moved',
      text: 'Keep this', model: privateRun.model }, { id: 'kept', name: 'Kept' });
    storage.runs.finish(kept.id, 'complete');
    storage.checkpoints.save([{ id: 'legacy-moved', projectId: 'kept', title: 'Legacy', updatedAt: 1,
      messages: [
        { id: privateRun.userMessageId, role: 'user', content: 'Private legacy input' },
        { id: privateRun.assistantMessageId, role: 'assistant', content: 'Private legacy answer' },
        { id: kept.userMessageId, role: 'user', content: 'Keep this' },
      ] }]);
    await storage.projects.delete('private');
    expect(storage.checkpoints.load()![0].messages.map(message => message.content)).toEqual(['Keep this']);
    expect(storage.chats.get('legacy-moved')?.messages.map(message => message.content)).toEqual(['Keep this', '']);
    expect(storage.runs.get(kept.id)).not.toBeNull();
  } finally {
    await storage.close();
  }
});

it('purges checkpoint retries cascaded from an original-project turn after a chat moves', async () => {
  const storage = openDesktopStorage(':memory:');
  try {
    const original = storage.beginShippingTurn({ requestId: 'private-original', chatId: 'retry-moved',
      text: 'Private original input', model: { providerId: 'claude', modelId: 'origin' } },
      { id: 'private', name: 'Private' });
    storage.runs.finish(original.id, 'failed');
    const kept = storage.beginShippingTurn({ requestId: 'kept-turn', chatId: 'retry-moved',
      text: 'Keep this', model: original.model }, { id: 'kept', name: 'Kept' });
    storage.runs.finish(kept.id, 'complete');
    const retry = storage.runs.retry(original.id, 'private-retry');
    storage.runs.appendDelta(retry.id, 'Private retried answer');
    storage.runs.finish(retry.id, 'failed');
    storage.checkpoints.save([{ id: 'retry-moved', projectId: 'kept', title: 'Moved', updatedAt: 1,
      messages: [
        { id: original.userMessageId, role: 'user', content: 'Private original input' },
        { id: retry.assistantMessageId, role: 'assistant', content: 'Private retried answer', attemptId: 'private-retry' },
        { id: kept.userMessageId, role: 'user', content: 'Keep this' },
      ] }]);
    await storage.projects.delete('private');
    expect(storage.runs.get(retry.id)).toBeNull();
    expect(storage.checkpoints.load()![0].messages.map(message => message.content)).toEqual(['Keep this']);
    expect(storage.chats.get('retry-moved')?.messages.map(message => message.content)).toEqual(['Keep this', '']);
    expect(storage.runs.get(kept.id)).not.toBeNull();
  } finally {
    await storage.close();
  }
});


it('preserves binary-only completion across restart without treating media bytes or names as text evidence', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.shipping-binary-'));
  const path = join(dir, 'jarvis.db');
  let storage = openDesktopStorage(path);
  let settle: (value: any) => void = () => {};
  const coordinator = createTaskCoordinator({ storage, openAttempt: (_request: any, receive: any) => {
    receive({ type: 'delta', text: 'The image contains a blue square.' });
    return { settled: new Promise(resolve => { settle = resolve; }), stop() { settle({ kind: 'interrupted' }); } };
  } });
  const data = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  try {
    const result = await coordinator.start({
      requestId: 'binary-only', target: { kind: 'chat', id: 'binary-chat', generation: 'one', ephemeral: false },
      provider: 'claude', model: 'origin', title: 'Image', modelLabel: 'Claude', instructions: '', history: [],
      input: { id: 'binary-input', role: 'user', content: '', attachments: [
        { id: 'image', name: 'private-preference.png', type: 'image/png', size: 8, data },
      ] },
    }, 1);
    expect(result.ok).toBe(true);
    settle({ kind: 'complete' });
    await expect.poll(() => storage.runs.list('binary-chat')[0]?.state).toBe('complete');
    coordinator.shutdown();
    await storage.close();
    storage = openDesktopStorage(path);
    const job = storage.memory.jobs()[0];
    expect(job).toBeDefined();
    const evidence = storage.memory.extractionInput(job.id)!;
    expect(evidence.snapshot.messages.map(message => message.content)).toEqual([
      '[Media-only input; attachment contents are unavailable to text memory.]',
      'The image contains a blue square.',
    ]);
    expect(JSON.stringify(evidence)).not.toContain(data);
    expect(JSON.stringify(evidence)).not.toContain('private-preference.png');
    await storage.chats.delete('binary-chat');
    expect(storage.memory.jobs()).toEqual([]);
    expect(storage.runs.list('binary-chat')).toEqual([]);
  } finally {
    coordinator.shutdown();
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
