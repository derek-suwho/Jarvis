import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as setup from '../../desktop/importers/setup';

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/importers/setup-descriptors.json', import.meta.url), 'utf8'));
const candidate = (category = 'instructions', source = 'claude-code') => ({
  source, category, sourceId: 'synthetic-asset', contentDigest: 'a'.repeat(64),
  scope: { kind: 'project', projectId: 'synthetic-project' },
});
const plan = (candidates: unknown, selections?: unknown) => {
  expect(setup.createSetupImportPlan).toBeTypeOf('function');
  return setup.createSetupImportPlan(candidates, selections);
};

describe('provider-neutral setup selection contracts', () => {
  it.each(['claude-code', 'claude-cowork', 'codex'])('plans %s descriptors without claiming discovery or content migration', source => {
    const result = plan([candidate('instructions', source)]);
    expect(result).toMatchObject({
      mode: 'agent-setup', phase: 'selection-plan', status: 'ready', schemaVersion: 1,
      credentials: 'excluded', memoryPolicy: 'exclude-from-automatic-memory',
      items: [{ source, category: 'instructions', selected: false, enabled: false, activation: 'not-activated' }],
      rejections: [],
    });
    expect(result.items[0].id).toMatch(/^import-setup-[a-f0-9]{64}$/);
    expect(result.items[0].revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('starts all categories unselected and preserves restrictive activation policies after selection', () => {
    const categories = ['instructions', 'skill', 'plugin', 'mcp-server', 'project', 'project-memory', 'hook'];
    const descriptors = categories.map(category => candidate(category));
    const preview = plan(descriptors);
    expect(preview.items).toHaveLength(7);
    expect(preview.items.every(item => !item.selected && !item.enabled)).toBe(true);
    const selected = plan(descriptors, preview.items.map(({ id, revision }) => ({ id, revision })));
    expect(selected.items.every(item => item.selected && !item.enabled)).toBe(true);
    for (const category of ['plugin', 'mcp-server']) {
      expect(selected.items.find(item => item.category === category)).toMatchObject({ activation: 'requires-explicit-review' });
    }
    expect(selected.items.find(item => item.category === 'hook')).toMatchObject({ activation: 'disabled' });
    expect(selected.items.find(item => item.category === 'project-memory')).toMatchObject({ memoryUse: 'project-reference-only' });
    expect(selected.memoryPolicy).toBe('exclude-from-automatic-memory');
  });

  it('selects only explicit current revisions and does not mutate descriptors', () => {
    const descriptors = fixture();
    const before = structuredClone(descriptors);
    const preview = plan(descriptors);
    const pick = preview.items.find(item => item.category === 'mcp-server')!;
    const selected = plan(descriptors, [{ id: pick.id, revision: pick.revision }]);
    expect(selected.items.filter(item => item.selected).map(item => item.id)).toEqual([pick.id]);
    expect(descriptors).toEqual(before);
    expect(plan(descriptors)).toEqual(preview);
  });

  it('keeps identity stable across content changes but rejects stale selection', () => {
    const descriptors = [candidate()];
    const original = plan(descriptors).items[0];
    descriptors[0].contentDigest = 'b'.repeat(64);
    const updated = plan(descriptors).items[0];
    expect(updated.id).toBe(original.id);
    expect(updated.revision).not.toBe(original.revision);
    expect(plan(descriptors, [{ id: original.id, revision: original.revision }]))
      .toMatchObject({ status: 'rejected', items: [], rejections: [{ code: 'STALE_SETUP_SELECTION' }] });
  });

  it('namespaces identity by source, category, and project scope', () => {
    const descriptors = [
      candidate(), candidate('instructions', 'codex'), candidate('skill'),
      { ...candidate(), scope: { kind: 'project', projectId: 'second-project' } },
      { ...candidate(), scope: { kind: 'user' } },
    ];
    expect(new Set(plan(descriptors).items.map(item => item.id)).size).toBe(5);
  });

  it('collapses exact repeats and rejects conflicting descriptors regardless of ordering', () => {
    const a = candidate();
    expect(plan([a, structuredClone(a)]).items).toHaveLength(1);
    const b = { ...a, contentDigest: 'b'.repeat(64) };
    for (const descriptors of [[a, b], [b, a]]) {
      expect(plan(descriptors)).toMatchObject({ status: 'rejected', items: [], rejections: [{ code: 'CONFLICTING_SETUP_ASSET' }] });
    }
  });

  it.each(['credentials', 'token', 'env', 'headers', 'command', 'args', 'url', 'payload', 'enabled', 'reviewed', '__proto__'])
    ('rejects credential/executable/unknown field %s without preserving its value', key => {
      const descriptor = { ...candidate('mcp-server'), [key]: 'PRIVATE_VALUE' };
      const result = plan([descriptor]);
      expect(result).toMatchObject({ status: 'rejected', items: [], rejections: [{ code: 'INVALID_SETUP_DESCRIPTOR' }] });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
    });

  it('emits only opaque references, never raw source/project identifiers or config values', () => {
    const descriptor = { ...candidate(), sourceId: 'PRIVATE_SOURCE', scope: { kind: 'project', projectId: 'PRIVATE_PROJECT' } };
    const result = plan([descriptor]);
    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.items[0].scope).toMatchObject({ kind: 'project', projectId: expect.stringMatching(/^import-project-[a-f0-9]{64}$/) });
  });

  it.each([null, {}, 'setup', [null], [{ ...candidate(), source: 'chatgpt' }], [{ ...candidate(), category: 'credentials' }],
    [{ ...candidate(), sourceId: {} }], [{ ...candidate(), sourceId: '' }], [{ ...candidate(), sourceId: 'x'.repeat(257) }],
    [{ ...candidate(), contentDigest: 'not-a-digest' }], [{ ...candidate(), scope: { kind: 'project' } }],
    [{ ...candidate(), scope: { kind: 'user', token: 'PRIVATE' } }],
  ].map(value => [value]))('rejects malformed descriptors atomically: %j', descriptors => {
    expect(plan(descriptors)).toMatchObject({ status: 'rejected', items: [] });
  });

  it.each(['project', 'project-memory'])('requires project scope for %s', category => {
    expect(plan([{ ...candidate(category), scope: { kind: 'user' } }])).toMatchObject({ status: 'rejected', items: [] });
  });

  it('rejects invalid, unknown, duplicate, or forged activation selections atomically', () => {
    const descriptors = fixture();
    const item = plan(descriptors).items[0];
    const ref = { id: item.id, revision: item.revision };
    for (const selections of [null, {}, ['unknown'], [{ ...ref, id: 'unknown' }], [ref, ref], [{ ...ref, enabled: true }], [{ ...ref, reviewed: true }]]) {
      expect(plan(descriptors, selections)).toMatchObject({ status: 'rejected', items: [] });
    }
  });

  it('bounds descriptor/selection counts even when duplicates would collapse', () => {
    expect(plan(Array.from({ length: 1001 }, () => candidate())))
      .toMatchObject({ status: 'rejected', items: [], rejections: [{ code: 'SETUP_LIMIT_EXCEEDED' }] });
    expect(plan([], Array.from({ length: 1001 }, () => ({}))))
      .toMatchObject({ status: 'rejected', items: [], rejections: [{ code: 'SETUP_LIMIT_EXCEEDED' }] });
  });

  it('rejects malformed or oversized selection references before treating them as stale', () => {
    const descriptors = [candidate()];
    const { id, revision } = plan(descriptors).items[0];
    for (const selection of [
      { id, revision: 'x'.repeat(65) }, { id, revision: 'g'.repeat(64) },
      { id: 'x'.repeat(10000), revision }, { id, revision: 'a'.repeat(10000) },
    ]) {
      expect(plan(descriptors, [selection])).toMatchObject({
        status: 'rejected', items: [], credentials: 'excluded', memoryPolicy: 'exclude-from-automatic-memory',
        rejections: [{ code: 'INVALID_SETUP_SELECTION' }],
      });
    }
  });

  it('rejects accessor-backed metadata without evaluating it', () => {
    let evaluated = false;
    const descriptor = { ...candidate(), get sourceId() { evaluated = true; return 'private'; } };
    expect(plan([descriptor])).toMatchObject({ status: 'rejected', items: [] });
    expect(evaluated).toBe(false);
  });
});
