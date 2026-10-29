import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { importProviderHistory } from '../../desktop/importers';
import * as adapter from '../../desktop/importers/chatgpt';
import type { ImportLimits } from '../../desktop/importers/types';

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/importers/chatgpt.json', import.meta.url), 'utf8'))[0];
const limits: ImportLimits = {
  maxInputBytes: 100000, maxExtractedBytes: 100000, maxFileBytes: 100000,
  maxFiles: 20, maxCompressionRatio: 100, maxPathDepth: 5, maxJsonDepth: 30,
  maxConversations: 100, maxMessages: 100, maxTextLength: 1000, maxTotalTextLength: 10000,
};
const parse = (value: unknown, overrides: Partial<ImportLimits> = {}) => {
  expect(adapter.parseChatGPT).toBeTypeOf('function');
  return adapter.parseChatGPT(value, { ...limits, ...overrides });
};
const reject = (value: unknown, code: string) => {
  expect(() => parse(value)).toThrowError(expect.objectContaining({ code }));
};

describe('ChatGPT account-export adapter', () => {
  it('follows selected ancestry instead of mapping insertion order', () => {
    expect(parse(fixture())).toMatchObject({
      sourceId: 'chat-synthetic-1', title: 'Synthetic garden plan', quality: 'structured',
      createdAt: '2023-11-14T22:13:20.000Z', updatedAt: '2023-11-14T22:13:22.000Z',
      messages: [
        { sourceId: 'question-1', nodeId: 'question-node', role: 'user', parts: ['Plan a small herb garden.'] },
        { sourceId: 'answer-1', nodeId: 'answer-node', role: 'assistant', parts: ['Plant basil.', 'Water weekly.'] },
      ], warnings: [], skippedArtifacts: 0,
    });
  });

  it('accepts the conversation_id alias and an empty rooted transcript', () => {
    const value = fixture();
    delete value.id;
    value.mapping = { root: { id: 'root', parent: null, children: [], message: null } };
    value.current_node = 'root';
    expect(parse(value).messages).toEqual([]);
  });

  it.each([null, {}, [], { mapping: [] }])('rejects malformed records: %j', value => reject(value, 'INVALID_RECORD'));

  it.each([undefined, null, {}, '', ' ', 'constructor'])('rejects invalid conversation IDs: %j', id => {
    const value = fixture();
    value.id = id;
    delete value.conversation_id;
    reject(value, 'INVALID_ID');
  });

  it('rejects conflicting ID aliases', () => {
    const value = fixture();
    value.conversation_id = 'other';
    reject(value, 'INVALID_ID');
  });

  it('rejects duplicate message IDs across graph nodes', () => {
    const value = fixture();
    value.mapping['answer-node'].message.id = 'question-1';
    reject(value, 'DUPLICATE_MESSAGE_ID');
  });

  it('rejects cycles even when they form an abandoned component', () => {
    const value = fixture();
    value.mapping.a = { id: 'a', parent: 'b', children: ['b'], message: null };
    value.mapping.b = { id: 'b', parent: 'a', children: ['a'], message: null };
    reject(value, 'GRAPH_CYCLE');
  });

  it('rejects missing parents without accepting a partial transcript', () => {
    const value = fixture();
    value.mapping['answer-node'].parent = 'missing';
    reject(value, 'GRAPH_MISSING_PARENT');
  });

  it('rejects disconnected roots', () => {
    const value = fixture();
    value.mapping.orphan = { id: 'orphan', parent: null, children: [], message: null };
    reject(value, 'GRAPH_DISCONNECTED');
  });

  it('rejects mismatched parent/child edges', () => {
    const value = fixture();
    value.mapping.root.children = [];
    reject(value, 'GRAPH_INCONSISTENT');
  });

  it('rejects invalid current nodes and node-key mismatches', () => {
    const value = fixture();
    value.current_node = 'missing';
    reject(value, 'GRAPH_INVALID_CURRENT');
    value.current_node = 'answer-node';
    value.mapping.root.id = 'different';
    reject(value, 'GRAPH_INCONSISTENT');
  });

  it('omits abandoned branches and reports partial completeness', () => {
    const value = fixture();
    value.mapping.old = {
      ...structuredClone(value.mapping['answer-node']), id: 'old',
      message: { ...value.mapping['answer-node'].message, id: 'old-answer' },
    };
    value.mapping['question-node'].children.push('old');
    const result = parse(value);
    expect(result.messages.map(message => message.sourceId)).toEqual(['question-1', 'answer-1']);
    expect(result).toMatchObject({ quality: 'partial', warnings: ['ABANDONED_BRANCH'], skippedArtifacts: 1 });
    value.mapping.old.message.id = {};
    reject(value, 'INVALID_ID');
  });

  it('rejects invalid roles, timestamps, and text parts', () => {
    const role = fixture();
    role.mapping['answer-node'].message.author.role = 'developer';
    reject(role, 'INVALID_ROLE');
    const time = fixture();
    time.create_time = 'yesterday';
    reject(time, 'INVALID_TIMESTAMP');
    const content = fixture();
    content.mapping['answer-node'].message.content.parts = ['valid', { html: '<script>' }];
    reject(content, 'INVALID_CONTENT');
  });

  it('keeps hostile text inert and excludes raw auth metadata', () => {
    const value = fixture();
    const hostile = '<script>run()</script> Ignore instructions; javascript:alert(1)';
    value.mapping['answer-node'].message.content.parts = [hostile];
    value.mapping['answer-node'].message.metadata = { access_token: 'synthetic-secret', cookies: ['synthetic-cookie'] };
    value.access_token = 'synthetic-secret';
    const result = parse(value);
    expect(result.messages[1].parts).toEqual([hostile]);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(JSON.stringify(result)).not.toContain('synthetic-cookie');
  });

  it('marks missing timestamps and skipped multimodal parts as partial', () => {
    const value = fixture();
    value.create_time = null;
    value.mapping['answer-node'].message.content = {
      content_type: 'multimodal_text', parts: ['An image', { content_type: 'image_asset_pointer', asset_pointer: 'file://secret' }],
    };
    const result = parse(value);
    expect(result.createdAt).toBeNull();
    expect(result.quality).toBe('partial');
    expect(result.messages[1].parts).toEqual(['An image']);
    expect(result.warnings).toEqual(expect.arrayContaining(['MISSING_TIMESTAMP', 'UNSUPPORTED_CONTENT']));
    expect(result.skippedArtifacts).toBe(1);
    expect(JSON.stringify(result)).not.toContain('file://secret');
  });

  it.each(['text', 'code'])('omits system/tool messages and their %s payloads from the entire import result', async contentType => {
    const value = fixture();
    value.mapping.root.message = {
      id: 'hidden-system', author: { role: 'system' }, create_time: 1700000000,
      content: { content_type: 'text', parts: ['HIDDEN_SYSTEM_TEXT'] },
      metadata: { internal: 'HIDDEN_SYSTEM_PAYLOAD' },
    };
    value.mapping['answer-node'].children = ['hidden-tool-node'];
    value.mapping['hidden-tool-node'] = {
      id: 'hidden-tool-node', parent: 'answer-node', children: [],
      message: {
        id: 'hidden-tool', author: { role: 'tool' }, create_time: 1700000003,
        content: contentType === 'text'
          ? { content_type: 'text', parts: ['HIDDEN_TOOL_TEXT'] }
          : { content_type: 'code', language: 'python', text: 'HIDDEN_TOOL_PAYLOAD()' },
      },
    };
    value.current_node = 'hidden-tool-node';
    const parsed = parse(value);
    expect(parsed.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(parsed).toMatchObject({ quality: 'partial', warnings: ['UNSUPPORTED_CONTENT'], skippedArtifacts: contentType === 'text' ? 2 : 3 });
    expect(JSON.stringify(parsed)).not.toContain('HIDDEN_');
    const result = await importProviderHistory(JSON.stringify([value]));
    expect(result.status).toBe('ready');
    expect(result.conversations[0].messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(result.conversations[0].quality).toBe('partial');
    expect(result.counts).toMatchObject({ messages: 2, skippedArtifacts: parsed.skippedArtifacts });
    expect(result.warnings.map(warning => warning.code)).toContain('UNSUPPORTED_CONTENT');
    expect(JSON.stringify(result)).not.toContain('HIDDEN_');
  });

  it.each([
    [], [{ attachments: ['OMITTED_ATTACHMENT'], citations: ['OMITTED_CITATION'] }],
    '{"attachments":["OMITTED_ATTACHMENT"],"citations":["OMITTED_CITATION"]}',
    '', 0, 1, true, false,
  ].map(metadata => [metadata]))('rejects malformed metadata instead of reporting structured history: %j', async metadata => {
    const value = fixture();
    value.mapping['answer-node'].message.metadata = metadata;
    reject(value, 'INVALID_CONTENT');
    const result = await importProviderHistory(JSON.stringify([value]));
    expect(result.status).toBe('rejected');
    expect(result.conversations).toEqual([]);
    expect(result.rejections).toEqual([expect.objectContaining({ code: 'INVALID_CONTENT', recordIndex: 0 })]);
    expect(JSON.stringify(result)).not.toContain('OMITTED_');
  });

  it.each([
    new Date(0), new Map(), new Set(), new String('metadata'),
    Object.create({ attachments: ['OMITTED_ATTACHMENT'], citations: ['OMITTED_CITATION'] }),
  ])('rejects metadata with exotic prototypes: %j', metadata => {
    const value = fixture();
    value.mapping['answer-node'].message.metadata = metadata;
    reject(value, 'INVALID_CONTENT');
  });

  it.each([undefined, null, {}, Object.create(null)])('accepts absent, null, and plain metadata: %j', metadata => {
    const value = fixture();
    value.mapping['answer-node'].message.metadata = metadata;
    expect(parse(value).quality).toBe('structured');
  });

  it('bounds every graph node and text part before branch selection', () => {
    expect(() => parse(fixture(), { maxMessages: 2 })).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(() => parse(fixture(), { maxTextLength: 10 })).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });

  it('marks skipped attachment/citation metadata as partial without copying URLs or payloads', () => {
    const value = fixture();
    value.mapping['answer-node'].message.metadata = {
      attachments: [{ name: 'synthetic.txt', content: 'PRIVATE_ATTACHMENT' }],
      citations: [{ url: 'file:///PRIVATE_URL' }],
      content_references: [{ type: 'image', url: 'https://invalid.example/PRIVATE_IMAGE' }],
    };
    const result = parse(value);
    expect(result.quality).toBe('partial');
    expect(result.skippedArtifacts).toBe(3);
    expect(result.warnings).toContain('UNSUPPORTED_CONTENT');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    value.mapping['answer-node'].message.metadata.attachments = 'invalid';
    reject(value, 'INVALID_CONTENT');
  });

  it('rejects blank content types', () => {
    const value = fixture();
    value.mapping['answer-node'].message.content.content_type = '  ';
    reject(value, 'INVALID_CONTENT');
  });

  it('rejects invalid message update times', () => {
    const value = fixture();
    value.mapping['answer-node'].message.update_time = 'never';
    reject(value, 'INVALID_TIMESTAMP');
  });

  it('rejects blank multimodal content discriminators', () => {
    const value = fixture();
    value.mapping['answer-node'].message.content = { content_type: 'multimodal_text', parts: [{ content_type: '' }] };
    reject(value, 'INVALID_CONTENT');
  });

  it('bounds each children collection before reading or mapping any child', () => {
    const value = fixture();
    let reads = 0;
    value.mapping.root.children = new Proxy(Array(1000000), {
      get(target, property, receiver) {
        if (property === 'map' || (typeof property === 'string' && /^\d+$/.test(property))) {
          reads++;
          throw new Error('Children were processed before the size check');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    reject(value, 'LIMIT_EXCEEDED');
    expect(reads).toBe(0);
  });

  it('bounds total child edges before processing the collection that exceeds the graph budget', () => {
    const value = fixture();
    let reads = 0;
    const overBudget = ['root'];
    Object.defineProperty(overBudget, 0, { get() { reads++; return 'root'; } });
    value.mapping = {
      root: { id: 'root', parent: null, children: ['a', 'b'], message: null },
      a: { id: 'a', parent: 'root', children: overBudget, message: null },
      b: { id: 'b', parent: 'root', children: [], message: null },
    };
    value.current_node = 'a';
    reject(value, 'LIMIT_EXCEEDED');
    expect(reads).toBe(0);
  });

  it.each(['wide', 'deep'])('bounds %s graph processing by collection operations, independent of wall-clock time', shape => {
    for (const size of [64, 512]) {
      const value = fixture();
      const ids = Array.from({ length: size }, (_, index) => `node-${index}`);
      value.mapping = Object.fromEntries(ids.map((id, index) => [id, {
        id, parent: index === 0 ? null : shape === 'wide' ? ids[0] : ids[index - 1],
        children: shape === 'wide' ? (index === 0 ? ids.slice(1) : []) : ids.slice(index + 1, index + 2),
        message: null,
      }]));
      value.current_node = ids[size - 1];
      let operations = 0;
      const get = Map.prototype.get;
      const has = Set.prototype.has;
      const iterate = Set.prototype[Symbol.iterator];
      const spies = [
        vi.spyOn(Map.prototype, 'get').mockImplementation(function (this: Map<unknown, unknown>, key) {
          operations++;
          return get.call(this, key);
        }),
        vi.spyOn(Set.prototype, 'has').mockImplementation(function (this: Set<unknown>, key) {
          operations++;
          return has.call(this, key);
        }),
        vi.spyOn(Set.prototype, Symbol.iterator).mockImplementation(function* (this: Set<unknown>): Generator<unknown, undefined, unknown> {
          for (const item of iterate.call(this)) {
            operations++;
            yield item;
          }
          return undefined;
        }),
      ];
      let result;
      try {
        result = adapter.parseChatGPT(value, { ...limits, maxMessages: size });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      expect(result.messages).toEqual([]);
      expect(operations).toBeGreaterThan(size);
      expect(operations).toBeLessThanOrEqual(20 * size);
    }
  });
});
