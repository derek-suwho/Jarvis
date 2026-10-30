import type { ParsedConversation, ParsedMessage } from './adapter-types';
import type { ImportLimits } from './types';
import { boundedText, RecordError, sourceId, timestamp } from './validation';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface Node {
  parent: string | null;
  children: Set<string>;
  message: ParsedMessage | null;
}

/** Parse a complete graph before selecting its active ancestry. No execution. */
export function parseChatGPT(value: unknown, limits: ImportLimits): ParsedConversation {
  if (!object(value) || !object(value.mapping) || typeof value.title !== 'string') {
    throw new RecordError('INVALID_RECORD');
  }
  const id = sourceId(value.id === undefined ? value.conversation_id : value.id);
  if (value.conversation_id !== undefined && sourceId(value.conversation_id) !== id) {
    throw new RecordError('INVALID_ID');
  }
  const warnings = new Set<string>();
  let skippedArtifacts = 0;
  const readTime = (time: unknown) => {
    const result = timestamp(time, 'unix');
    if (result === null) warnings.add('MISSING_TIMESTAMP');
    return result;
  };
  const title = boundedText(value.title, limits);
  const createdAt = readTime(value.create_time);
  const updatedAt = readTime(value.update_time);
  const nodes = new Map<string, Node>();
  const messageIds = new Set<string>();
  const entries = Object.entries(value.mapping);
  if (entries.length > limits.maxMessages) throw new RecordError('LIMIT_EXCEEDED');
  if (!entries.length) throw new RecordError('GRAPH_DISCONNECTED');
  // A rooted tree has exactly nodes - 1 edges. Bound allocation before reading children.
  const maxEdges = entries.length - 1;
  let edgeCount = 0;

  for (const [key, raw] of entries) {
    sourceId(key);
    if (!object(raw) || sourceId(raw.id) !== key || !Array.isArray(raw.children)) {
      throw new RecordError('GRAPH_INCONSISTENT');
    }
    if (raw.children.length > maxEdges || raw.children.length > maxEdges - edgeCount) {
      throw new RecordError('LIMIT_EXCEEDED');
    }
    edgeCount += raw.children.length;
    const parent = raw.parent === null ? null : sourceId(raw.parent);
    const children = new Set<string>();
    for (const child of raw.children) {
      const id = sourceId(child);
      if (children.has(id)) throw new RecordError('GRAPH_INCONSISTENT');
      children.add(id);
    }
    let message: ParsedMessage | null = null;
    if (raw.message !== null) {
      if (!object(raw.message)) throw new RecordError('INVALID_RECORD');
      const rawMessage = raw.message;
      const messageId = sourceId(rawMessage.id);
      if (messageIds.has(messageId)) throw new RecordError('DUPLICATE_MESSAGE_ID');
      messageIds.add(messageId);
      timestamp(rawMessage.update_time, 'unix');
      if (!object(rawMessage.author) || !['user', 'assistant', 'system', 'tool'].includes(rawMessage.author.role as string)) {
        throw new RecordError('INVALID_ROLE');
      }
      if (!object(rawMessage.content) || typeof rawMessage.content.content_type !== 'string' || !rawMessage.content.content_type.trim()) {
        throw new RecordError('INVALID_CONTENT');
      }
      const metadata = rawMessage.metadata;
      if (metadata !== undefined && metadata !== null) {
        if (!plainObject(metadata)) throw new RecordError('INVALID_CONTENT');
        for (const key of ['attachments', 'files', 'citations', 'content_references']) {
          const artifacts = metadata[key];
          if (artifacts === undefined || artifacts === null) continue;
          if (!Array.isArray(artifacts)) throw new RecordError('INVALID_CONTENT');
          if (artifacts.length) {
            warnings.add('UNSUPPORTED_CONTENT');
            skippedArtifacts += artifacts.length;
          }
        }
      }
      const content = rawMessage.content;
      const parts: string[] = [];
      if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
        if (!Array.isArray(content.parts)) throw new RecordError('INVALID_CONTENT');
        for (const part of content.parts) {
          if (typeof part === 'string') {
            parts.push(boundedText(part, limits));
          } else if (content.content_type === 'multimodal_text' && object(part) && typeof part.content_type === 'string' && part.content_type.trim()) {
            warnings.add('UNSUPPORTED_CONTENT');
            skippedArtifacts++;
          } else {
            throw new RecordError('INVALID_CONTENT');
          }
        }
      } else {
        warnings.add('UNSUPPORTED_CONTENT');
        skippedArtifacts++;
      }
      const createdAt = readTime(rawMessage.create_time);
      const role = rawMessage.author.role;
      if (role === 'user' || role === 'assistant') {
        message = { sourceId: messageId, nodeId: key, role, createdAt, parts };
      } else {
        warnings.add('UNSUPPORTED_CONTENT');
        skippedArtifacts++;
      }
    }
    nodes.set(key, { parent, children, message });
  }

  // Parent walks are iterative and memoized: bounded O(nodes + edges), no recursion.
  for (const node of nodes.values()) {
    if (node.parent !== null && !nodes.has(node.parent)) throw new RecordError('GRAPH_MISSING_PARENT');
  }
  const visited = new Set<string>();
  for (const key of nodes.keys()) {
    const path = new Set<string>();
    let current: string | null = key;
    while (current !== null && !visited.has(current)) {
      if (path.has(current)) throw new RecordError('GRAPH_CYCLE');
      path.add(current);
      current = nodes.get(current)!.parent;
    }
    for (const item of path) visited.add(item);
  }
  if ([...nodes.values()].filter(node => node.parent === null).length !== 1) {
    throw new RecordError('GRAPH_DISCONNECTED');
  }
  for (const [key, node] of nodes) {
    if (node.parent !== null && !nodes.get(node.parent)!.children.has(key)) {
      throw new RecordError('GRAPH_INCONSISTENT');
    }
    for (const child of node.children) {
      if (!nodes.has(child) || nodes.get(child)!.parent !== key) throw new RecordError('GRAPH_INCONSISTENT');
    }
  }
  let current: string | null = sourceId(value.current_node);
  if (!nodes.has(current)) throw new RecordError('GRAPH_INVALID_CURRENT');
  const selected = new Set<string>();
  const messages: ParsedMessage[] = [];
  while (current !== null) {
    selected.add(current);
    const node: Node = nodes.get(current)!;
    if (node.message) messages.push(node.message);
    current = node.parent;
  }
  if (selected.size !== nodes.size) {
    warnings.add('ABANDONED_BRANCH');
    skippedArtifacts += nodes.size - selected.size;
  }
  messages.reverse();
  return {
    sourceId: id, title, createdAt, updatedAt,
    quality: warnings.size ? 'partial' : 'structured', messages,
    warnings: [...warnings].sort(), skippedArtifacts,
  };
}
