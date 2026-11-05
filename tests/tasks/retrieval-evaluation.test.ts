import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { openDesktopStorage } from '../../desktop/runtime';
const { createTaskCoordinator } = createRequire(import.meta.url)('../../electron/tasks/coordinator.cjs');

// Fixed before implementation; two vocabulary-only paraphrases intentionally
// measure the lexical retriever's limitations rather than hiding those misses.
const scenarios = [
  { name: 'global across providers', query: 'Which database?', want: ['GlobalDB'] },
  { name: 'active project', query: 'Which database?', active: 'design', want: ['GlobalDB', 'DesignDB'], exclude: ['EngineeringDB'] },
  { name: 'explicit project', query: 'Which database for Design?', want: ['DesignDB'], exclude: ['EngineeringDB'] },
  { name: 'project alias', query: 'Which database for Studio?', want: ['DesignDB'], exclude: ['EngineeringDB'] },
  { name: 'second project', query: 'Which database for Engineering?', want: ['EngineeringDB'], exclude: ['DesignDB'] },
  { name: 'comparison', query: 'Compare Design and Engineering databases', want: ['DesignDB', 'EngineeringDB'] },
  { name: 'all projects', query: 'Compare databases across all projects', want: ['DesignDB', 'EngineeringDB'] },
  { name: 'plural inflection', query: 'Which databases?', active: 'design', want: ['DesignDB'] },
  { name: 'compatibility text', query: 'Ｄｅｓｉｇｎ ｄａｔａｂａｓｅ', want: ['DesignDB'] },
  { name: 'case folding', query: 'STUDIO DATABASE', want: ['DesignDB'] },
  { name: 'word boundaries', query: 'Designated database', want: ['GlobalDB'], exclude: ['DesignDB', 'EngineeringDB'] },
  { name: 'unscoped exclusion', query: 'Which database?', want: ['GlobalDB'], exclude: ['UnscopedDB'] },
  { name: 'forgotten exclusion', query: 'Which database?', want: ['GlobalDB'], exclude: ['ForgottenDB'] },
  { name: 'deleted source exclusion', query: 'Which database?', want: ['GlobalDB'], exclude: ['DeletedDB'] },
  { name: 'unrelated query', query: 'Vacation destination?', want: [], exclude: ['GlobalDB', 'DesignDB', 'EngineeringDB'] },
  { name: 'lexical paraphrase', query: 'Remind me of the database choice in Studio', want: ['DesignDB'] },
  { name: 'punctuated alias', query: 'Studio: database?', want: ['DesignDB'] },
  { name: 'ambiguous active alias', query: 'Which database for Shared?', active: 'design', want: [], exclude: ['DesignDB', 'EngineeringDB'], clarify: true },
  { name: 'semantic paraphrase storage engine', query: 'Which persistence engine?', want: ['GlobalDB'] },
  { name: 'semantic paraphrase technical stack', query: 'What powers durable records in Studio?', want: ['DesignDB'] },
];

it('meets the fixed 18/20 shipping retrieval bar and every deletion/wrong-project negative', async () => {
  expect(scenarios).toHaveLength(20);
  const outcomes: { name: string; hit: boolean }[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    // Independent databases prevent earlier queries/extraction from helping later cases.
    const storage = openDesktopStorage(':memory:');
    const captured: any[] = [];
    const coordinator = createTaskCoordinator({ storage, openAttempt: (input: any) => {
      captured.push(input);
      return { settled: Promise.resolve({ kind: 'complete' }), stop() {} };
    } });
    try {
      const design = storage.projects.create('Design', ['Studio', 'Shared']);
      const engineering = storage.projects.create('Engineering', ['Shared']);
      const seed = (value: string, project: typeof design | null, global = false) => {
        const run = storage.beginShippingTurn({ requestId: value, chatId: value, text: `Use ${value}`,
          model: { providerId: 'chatgpt', modelId: 'origin' } }, project);
        storage.runs.finish(run.id, 'complete');
        const job = storage.memory.jobs().find(job => job.userMessageId === run.userMessageId)!;
        storage.memory.apply(job.id, { summary: '', facts: [{
          scope: global ? { kind: 'global' } : { kind: 'project', projectId: project?.id ?? null },
          subject: 'user', key: `database_${value}`, value, keywords: ['database'], kind: 'assertion',
          sourceMessageIds: [run.userMessageId], evidence: [{ messageId: run.userMessageId, quote: `Use ${value}` }],
        }] });
        return storage.memory.list().find(fact => fact.value === value)!;
      };
      seed('GlobalDB', null, true);
      seed('DesignDB', design);
      seed('EngineeringDB', engineering);
      seed('UnscopedDB', null);
      storage.memory.forget(seed('ForgottenDB', null, true).id);
      seed('DeletedDB', null, true);
      await storage.chats.delete('DeletedDB');
      const result = await coordinator.start({ requestId: `evaluation-${index}`,
        target: { kind: 'chat', id: 'evaluation', generation: 'one', ephemeral: false },
        ...(scenario.active ? { project: design } : {}),
        provider: ['claude', 'gemini', 'grok', 'chatgpt'][index % 4], model: 'origin',
        title: 'Evaluation', modelLabel: 'Fixture', instructions: '', history: [],
        input: { id: 'question', role: 'user', content: scenario.query },
      }, 1);
      expect(result.ok, scenario.name).toBe(true);
      await expect.poll(() => coordinator.snapshot()[0]?.state).toBe('complete');
      const sent = JSON.stringify(captured[0].request.messages);
      for (const value of scenario.exclude ?? []) expect(sent, scenario.name).not.toContain(value);
      if (scenario.clarify) expect(sent, scenario.name).toContain('ambiguous');
      expect(sent, scenario.name).not.toContain('ForgottenDB');
      expect(sent, scenario.name).not.toContain('DeletedDB');
      expect(sent, scenario.name).not.toContain('UnscopedDB');
      expect(storage.chats.get('evaluation')?.messages[0].content).toBe(scenario.query);
      outcomes.push({ name: scenario.name, hit: scenario.want.every(value => sent.includes(value)) });
    } finally {
      coordinator.shutdown();
      await storage.close();
    }
  }
  const misses = outcomes.filter(outcome => !outcome.hit).map(outcome => outcome.name);
  console.info(`Shipping retrieval evaluation: ${20 - misses.length}/20; misses: ${misses.join(', ') || 'none'}`);
  expect(outcomes.filter(outcome => outcome.hit).length, JSON.stringify(misses)).toBeGreaterThanOrEqual(18);
});
