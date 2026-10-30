import { createHash } from 'node:crypto';
import { RecordError, sourceId } from './validation';
import type { AgentSetupSource, SetupCategory, SetupPlanItem, SetupScope, SetupSelectionPlan } from './setup-types';
export type * from './setup-types';

const MAX_ASSETS = 1000;
const sources: readonly string[] = ['claude-code', 'claude-cowork', 'codex'];
const categories: readonly string[] = ['instructions', 'skill', 'plugin', 'mcp-server', 'project', 'project-memory', 'hook'];
const hash = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const messages: Record<string, string> = {
  INVALID_SETUP_DESCRIPTOR: 'Setup descriptors must contain only supported, bounded metadata.',
  INVALID_SETUP_SELECTION: 'Select each known setup asset once using its current revision.',
  STALE_SETUP_SELECTION: 'A selected setup asset changed; review its new revision before selecting it.',
  CONFLICTING_SETUP_ASSET: 'Conflicting setup descriptors claim the same identity.',
  SETUP_LIMIT_EXCEEDED: 'The setup plan exceeds the supported asset or selection count.',
};

function exactFields(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return false;
  return own.every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === 'string' && keys.includes(key) && 'value' in property && property.enumerable;
  });
}

function parseScope(value: unknown): SetupScope {
  if (exactFields(value, ['kind']) && value.kind === 'user') return { kind: 'user' };
  if (exactFields(value, ['kind', 'projectId']) && value.kind === 'project') {
    return { kind: 'project', projectId: sourceId(value.projectId) };
  }
  throw new RecordError('INVALID_SETUP_DESCRIPTOR');
}

function parseDescriptor(value: unknown): SetupPlanItem {
  if (!exactFields(value, ['source', 'sourceId', 'category', 'scope', 'contentDigest'])
    || !sources.includes(value.source as string) || !categories.includes(value.category as string)
    || typeof value.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentDigest)) {
    throw new RecordError('INVALID_SETUP_DESCRIPTOR');
  }
  const source = value.source as AgentSetupSource;
  const category = value.category as SetupCategory;
  const locator = sourceId(value.sourceId);
  const scope = parseScope(value.scope);
  if ((category === 'project' || category === 'project-memory') && scope.kind !== 'project') {
    throw new RecordError('INVALID_SETUP_DESCRIPTOR');
  }
  const project = scope.kind === 'project' ? scope.projectId : '';
  const id = `import-setup-${hash(source, category, scope.kind, project, locator)}`;
  const base = {
    id, revision: hash(id, value.contentDigest), source,
    scope: scope.kind === 'user' ? scope : { kind: 'project' as const, projectId: `import-project-${hash(source, project)}` },
    selected: false, enabled: false as const,
  };
  if (category === 'hook') return { ...base, category, activation: 'disabled', memoryUse: 'none' };
  if (category === 'plugin' || category === 'mcp-server') {
    return { ...base, category, activation: 'requires-explicit-review', memoryUse: 'none' };
  }
  if (category === 'project-memory') return { ...base, category, activation: 'not-activated', memoryUse: 'project-reference-only' };
  return { ...base, category, activation: 'not-activated', memoryUse: 'none' };
}

function emptyPlan(): SetupSelectionPlan {
  return {
    mode: 'agent-setup', phase: 'selection-plan', schemaVersion: 1, status: 'rejected',
    credentials: 'excluded', memoryPolicy: 'exclude-from-automatic-memory', items: [], rejections: [],
  };
}

/**
 * Plan metadata-only selections from future adapters. No local discovery, payload
 * import, review approval, installation, activation, or memory writes occur here.
 */
export function createSetupImportPlan(descriptors: unknown, selections: unknown = []): SetupSelectionPlan {
  try {
    if (!Array.isArray(descriptors)) throw new RecordError('INVALID_SETUP_DESCRIPTOR');
    if (!Array.isArray(selections)) throw new RecordError('INVALID_SETUP_SELECTION');
    if (descriptors.length > MAX_ASSETS || selections.length > MAX_ASSETS) throw new RecordError('SETUP_LIMIT_EXCEEDED');
    const items = new Map<string, SetupPlanItem>();
    for (const descriptor of descriptors) {
      const item = parseDescriptor(descriptor);
      const previous = items.get(item.id);
      if (previous && previous.revision !== item.revision) throw new RecordError('CONFLICTING_SETUP_ASSET');
      items.set(item.id, item);
    }
    for (const selection of selections) {
      if (!exactFields(selection, ['id', 'revision'])
        || typeof selection.id !== 'string' || !/^import-setup-[a-f0-9]{64}$/.test(selection.id)
        || typeof selection.revision !== 'string' || !/^[a-f0-9]{64}$/.test(selection.revision)) {
        throw new RecordError('INVALID_SETUP_SELECTION');
      }
      const item = items.get(selection.id);
      if (!item || item.selected) throw new RecordError('INVALID_SETUP_SELECTION');
      if (selection.revision !== item.revision) throw new RecordError('STALE_SETUP_SELECTION');
      item.selected = true;
    }
    return { ...emptyPlan(), status: 'ready', items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  } catch (error) {
    if (!(error instanceof RecordError)) throw error;
    const code = Object.hasOwn(messages, error.code) ? error.code : 'INVALID_SETUP_DESCRIPTOR';
    return { ...emptyPlan(), rejections: [{ code, message: messages[code] }] };
  }
}
