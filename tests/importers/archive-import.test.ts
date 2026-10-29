import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importProviderHistory } from '../../desktop/importers';
import { centralOffset, zip } from './zip-fixture';

const fixture = (provider: string) => readFileSync(new URL(`../fixtures/importers/${provider}.json`, import.meta.url), 'utf8');

describe('archive-to-preview boundary', () => {
  it.each(['chatgpt', 'claude'])('produces the same canonical %s records from ZIP and JSON', async provider => {
    const json = fixture(provider);
    const archived = await importProviderHistory(zip([
      { name: 'export/conversations.json', content: json, deflate: true, descriptor: 'signed' },
      { name: 'export/user.json', content: '{"access_token":"SYNTHETIC_SECRET"}' },
      { name: 'export/chat.html', content: '<script>neverExecute()</script>' },
    ]));
    const standalone = await importProviderHistory(json);
    expect(archived.status).toBe('ready');
    expect(archived.conversations).toEqual(standalone.conversations);
    expect(archived.counts.skippedArtifacts).toBe(2);
    expect(archived.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_ARTIFACT' }));
    expect(JSON.stringify(archived)).not.toContain('SYNTHETIC_SECRET');
    expect(JSON.stringify(archived)).not.toContain('neverExecute');
  });

  it('deduplicates shards and keeps updates stable across archive packaging', async () => {
    const records = JSON.parse(fixture('chatgpt'));
    const first = await importProviderHistory(fixture('chatgpt'));
    const duplicate = await importProviderHistory(zip([
      { name: 'conversations-0.json', content: JSON.stringify(records) },
      { name: 'conversations-1.json', content: JSON.stringify(records) },
    ]));
    expect(duplicate.conversations).toEqual(first.conversations);
    records[0].mapping['answer-node'].message.content.parts = ['Updated in later archive.'];
    const bytes = zip([{ name: 'conversations-1.json', content: JSON.stringify(records), deflate: true }]);
    const update = await importProviderHistory(bytes);
    expect(update.conversations[0].id).toBe(first.conversations[0].id);
    expect(update.conversations[0].messages[1].id).toBe(first.conversations[0].messages[1].id);
    expect(update.conversations[0].revision).not.toBe(first.conversations[0].revision);
    expect(await importProviderHistory(bytes)).toEqual(update);
  });

  it('validates provider content regardless of the conversation filename', async () => {
    const result = await importProviderHistory(zip([{ name: 'conversations.json', content: '[{"cookies":"synthetic"}]' }]));
    expect(result).toMatchObject({ status: 'rejected', provider: null, conversations: [] });
  });

  it('clears all records when a later shard is malformed or exceeds global budgets', async () => {
    const valid = { name: 'conversations-0.json', content: fixture('chatgpt') };
    const malformed = await importProviderHistory(zip([valid, { name: 'conversations-1.json', content: '{invalid' }]));
    expect(malformed).toMatchObject({ status: 'rejected', conversations: [], counts: { conversations: 0, messages: 0 } });
    const excessive = await importProviderHistory(zip([valid, { ...valid, name: 'conversations-1.json' }]), { limits: { maxConversations: 1 } });
    expect(excessive).toMatchObject({ status: 'rejected', conversations: [], rejections: [{ code: 'LIMIT_EXCEEDED' }] });
  });

  it('rejects unsafe or corrupt ignored entries without returning an accepted preview', async () => {
    const valid = { name: 'conversations.json', content: fixture('claude') };
    const unsafe = await importProviderHistory(zip([valid, { name: '../cookie.txt', content: 'SYNTHETIC_PRIVATE' }]));
    expect(unsafe).toMatchObject({ status: 'rejected', conversations: [], rejections: [{ code: 'UNSAFE_ARCHIVE' }] });
    expect(JSON.stringify(unsafe)).not.toContain('SYNTHETIC_PRIVATE');
    const corrupt = zip([{ name: 'conversations.json', content: fixture('chatgpt') }]);
    corrupt.writeUInt32LE(0, 14);
    corrupt.writeUInt32LE(0, centralOffset(corrupt) + 16);
    expect(await importProviderHistory(corrupt)).toMatchObject({ status: 'rejected', conversations: [], rejections: [{ code: 'INVALID_ARCHIVE' }] });
  });

  it('returns no records when cancelled during a multi-entry ZIP import', async () => {
    const controller = new AbortController();
    const input = zip(Array.from({ length: 10 }, (_, index) => ({ name: `conversations-${index}.json`, content: fixture('chatgpt') })));
    const pending = importProviderHistory(input, { signal: controller.signal });
    setImmediate(() => controller.abort('PRIVATE_REASON'));
    const result = await pending;
    expect(result).toMatchObject({ status: 'cancelled', conversations: [], counts: { conversations: 0, messages: 0 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_REASON');
  });
});
