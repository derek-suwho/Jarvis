import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as adapter from '../../desktop/importers/claude';
import type { ImportLimits } from '../../desktop/importers/types';

const limits: ImportLimits = {
  maxInputBytes: 1_000_000,
  maxExtractedBytes: 1_000_000,
  maxFileBytes: 1_000_000,
  maxFiles: 20,
  maxCompressionRatio: 100,
  maxPathDepth: 8,
  maxJsonDepth: 32,
  maxConversations: 20,
  maxMessages: 100,
  maxTextLength: 1_000,
  maxTotalTextLength: 10_000,
};

function fixture() {
  return JSON.parse(readFileSync(new URL('../fixtures/importers/claude.json', import.meta.url), 'utf8'))[0];
}

describe('Claude account export adapter', () => {
  it('preserves ordered text parts, source IDs, roles, and timestamps', () => {
    expect(adapter.parseClaude).toBeTypeOf('function');
    expect(adapter.parseClaude(fixture(), limits)).toEqual({
      sourceId: 'claude-conversation-1',
      title: 'Synthetic garden plan',
      createdAt: '2024-02-29T12:00:00.123Z',
      updatedAt: '2024-02-29T12:01:00.000Z',
      quality: 'structured',
      messages: [
        { sourceId: 'claude-message-1', role: 'user', createdAt: '2024-02-29T12:00:00.123Z', parts: ['Suggest a small garden.'] },
        { sourceId: 'claude-message-2', role: 'assistant', createdAt: '2024-02-29T12:01:00.000Z', parts: ['Plant herbs.', 'Leave space for paths.'] },
      ],
      warnings: [],
      skippedArtifacts: 0,
    });
  });

  it.each([null, [], 'conversation', {}, { chat_messages: {} }].map(value => [value]))('rejects malformed conversation records safely: %j', value => {
    expect(() => adapter.parseClaude(value, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }));
  });

  it.each([null, [], 'message'].map(value => [value]))('rejects malformed messages safely: %j', value => {
    const input = fixture();
    input.chat_messages[0] = value;
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_MESSAGE' }));
  });

  it.each([undefined, null, '', 'system', 'tool', {}, 'user'])('rejects unknown senders: %j', sender => {
    const input = fixture();
    input.chat_messages[0].sender = sender;
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_ROLE' }));
  });

  it('rejects duplicate message IDs without returning a partial conversation', () => {
    const input = fixture();
    input.chat_messages[1].uuid = input.chat_messages[0].uuid;
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_MESSAGE_ID' }));
  });

  it('rejects invalid message update timestamps even though they are not emitted', () => {
    const input = fixture();
    input.chat_messages[0].updated_at = 'not a timestamp';
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_TIMESTAMP' }));
  });

  it.each([undefined, []].map(value => [value]))('falls back to plain text when content is absent or empty: %j', content => {
    const input = fixture();
    input.chat_messages[0].content = content;
    input.chat_messages[0].text = 'Fallback text';
    expect(adapter.parseClaude(input, limits).messages[0].parts).toEqual(['Fallback text']);
  });

  it.each([null, {}, 'content', [null], [[]], [{ text: 'missing type' }], [{ type: {} }]].map(value => [value]))('rejects malformed content blocks: %j', content => {
    const input = fixture();
    input.chat_messages[0].content = content;
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_CONTENT' }));
  });

  it('skips unsupported typed blocks and reports partial completeness', () => {
    const input = fixture();
    input.chat_messages[1].content = [
      { type: 'text', text: 'Retained text' },
      { type: 'tool_use', name: 'exec', input: { command: 'do not execute' }, text: 'tool secret' },
      { type: 'thinking', text: 'thinking secret' },
      { type: 'image', url: 'javascript:doNotExecute()', text: 'media secret' },
      { type: 'future_type', text: 'unknown secret' },
    ];
    input.chat_messages[1].text = 'Do not import concatenated unsupported text';
    const result = adapter.parseClaude(input, limits);
    expect(result.messages[1].parts).toEqual(['Retained text']);
    expect(result.quality).toBe('partial');
    expect(result.skippedArtifacts).toBe(4);
    expect(result.warnings).toContain('UNSUPPORTED_CONTENT');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('preserves an empty message placeholder when every block is unsupported', () => {
    const input = fixture();
    input.chat_messages[1].content = [{ type: 'tool_result', text: 'ignored result' }];
    input.chat_messages[1].text = 'Never fall back through unsupported blocks';
    const result = adapter.parseClaude(input, limits);
    expect(result.messages[1]).toMatchObject({ sourceId: 'claude-message-2', parts: [] });
    expect(result.quality).toBe('partial');
    expect(result.skippedArtifacts).toBe(1);
  });

  it('labels missing timestamps without inventing dates', () => {
    const input = fixture();
    delete input.created_at;
    input.updated_at = null;
    delete input.chat_messages[0].created_at;
    const result = adapter.parseClaude(input, limits);
    expect(result.createdAt).toBeNull();
    expect(result.updatedAt).toBeNull();
    expect(result.messages[0].createdAt).toBeNull();
    expect(result.quality).toBe('partial');
    expect(result.warnings).toContain('MISSING_TIMESTAMP');
  });

  it('counts all messages before filtering unsupported content', () => {
    const input = fixture();
    input.chat_messages[1].content = [{ type: 'tool_result' }];
    expect(() => adapter.parseClaude(input, { ...limits, maxMessages: 1 })).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });

  it('reports skipped attachments, files, and citations without copying their data', () => {
    const input = fixture();
    input.chat_messages[0].attachments = [{ file_name: 'private.txt', extracted_content: 'attachment-secret' }];
    input.chat_messages[0].files = [{ file_name: 'private.png', preview_url: 'file:///private/secret' }];
    input.chat_messages[1].content[0].citations = [{ details: { type: 'web', url: 'javascript:secret()' } }];
    const result = adapter.parseClaude(input, limits);
    expect(result.quality).toBe('partial');
    expect(result.skippedArtifacts).toBe(3);
    expect(result.warnings).toContain('UNSUPPORTED_CONTENT');
    expect(result.messages[0].parts).toEqual(['Suggest a small garden.']);
    expect(result.messages[1].parts).toEqual(['Plant herbs.', 'Leave space for paths.']);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each(['attachments', 'files'])('rejects malformed %s containers', field => {
    const input = fixture();
    input.chat_messages[0][field] = { unexpected: 'object' };
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_CONTENT' }));
  });

  it('rejects malformed citation containers', () => {
    const input = fixture();
    input.chat_messages[0].content[0].citations = 'not an array';
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_CONTENT' }));
  });

  it('accepts null optional citations without treating absent citations as lost content', () => {
    const input = fixture();
    input.chat_messages[0].content[0].citations = null;
    const result = adapter.parseClaude(input, limits);
    expect(result.quality).toBe('structured');
    expect(result.skippedArtifacts).toBe(0);
  });

  it('rejects blank block discriminators', () => {
    const input = fixture();
    input.chat_messages[0].content[0].type = ' \t';
    expect(() => adapter.parseClaude(input, limits)).toThrowError(expect.objectContaining({ code: 'INVALID_CONTENT' }));
  });
});
