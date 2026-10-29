import type { Message, ToolUse } from './chats';
import { newId } from './chats';
import type { ChatGPTModel, ClaudeStreamPayload, StreamBridge } from './desktop';
import { buildReplyHistory } from './replyContext';
import type { ReplyMessage } from './replyContext';

interface ReplyTarget {
  /** Model slug sent to the Responses API. */
  model: string;
  /** Label stored on the reply (shown above it). */
  label: string;
  /** Conversation so far, oldest first, ending with the new user message. */
  history: Message[];
  /** Personal and project instructions, supplied as explicit user context. */
  instructions?: string;
  append: (msg: Message) => void;
  update: (id: string, patch: { content: string; tools?: ToolUse[] }) => void;
  /** Called once when the first text or tool activity arrives. */
  onFirstToken?: () => void;
  /** Called once when the reply finishes, fails, or is stopped. */
  onSettled: () => void;
  /** Id for the reply message (lets callers track the streaming message). */
  replyId?: string;
}

export async function fetchChatGPTModels(): Promise<ChatGPTModel[]> {
  const bridge = window.jarvis?.chatgpt;
  return bridge ? bridge.models() : [];
}

/**
 * Streams a ChatGPT-plan reply into a conversation: the reply message appears on the first token and
 * grows as text arrives; failures are added as an error message. Returns an abort function.
 */
export function streamChatGPTReply(t: ReplyTarget): () => void {
  return streamLiveReply(window.jarvis?.chatgpt, (messages) => ({ model: t.model, messages }), t, 'ChatGPT');
}

/** Claude through the user's Claude Code. `conversationId` lets the main process reuse its session. */
export function streamClaudeReply(
  t: ReplyTarget & { mode: ClaudeStreamPayload['mode']; reasoning: string; conversationId: string },
): () => void {
  return streamLiveReply(
    window.jarvis?.claude,
    (messages) => ({ model: t.model, mode: t.mode, reasoning: t.reasoning, conversationId: t.conversationId, messages }),
    t,
    'Claude',
  );
}

/** A real provider reply: which provider, model slug, and the conversation to send (ending with the prompt). */
export type LiveReply =
  | { provider: 'chatgpt' | 'gemini' | 'grok'; slug: string; history: Message[]; instructions?: string }
  | {
      provider: 'claude';
      slug: string;
      history: Message[];
      instructions?: string;
      mode: 'chat' | 'code';
      reasoning: string;
      conversationId: string;
    };

/** Streams a reply from whichever provider `live` names. */
export function streamLive(live: LiveReply, t: Omit<ReplyTarget, 'model' | 'history'>): () => void {
  const target = { ...t, model: live.slug, history: live.history, instructions: live.instructions };
  if (live.provider === 'gemini' || live.provider === 'grok') {
    return streamLiveReply(window.jarvis?.[live.provider], (messages) => ({ model: live.slug, messages }), target, live.provider === 'gemini' ? 'Gemini' : 'Grok');
  }
  return live.provider === 'claude'
    ? streamClaudeReply({ ...target, mode: live.mode, reasoning: live.reasoning, conversationId: live.conversationId })
    : streamChatGPTReply(target);
}

function streamLiveReply<P>(
  bridge: StreamBridge<P> | undefined,
  payload: (messages: ReplyMessage[]) => P,
  t: ReplyTarget,
  provider: string,
): () => void {
  const fail = (message: string) =>
    t.append({ id: newId(), role: 'assistant', content: message, model: t.label, error: true });
  if (!bridge) {
    fail(`${provider} is only available in the Jarvis desktop app.`);
    t.onSettled();
    return () => {};
  }

  let messages: ReplyMessage[];
  try {
    messages = buildReplyHistory(t.history, t.instructions);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Could not prepare this conversation.');
    t.onSettled();
    return () => {};
  }

  const requestId = newId();
  const replyId = t.replyId ?? newId();
  let text = '';
  let tools: ToolUse[] | undefined;
  let started = false;
  let settled = false;
  const show = () => {
    if (!started) {
      started = true;
      t.onFirstToken?.();
      t.append({ id: replyId, role: 'assistant', content: text, model: t.label, ...(tools ? { tools } : {}) });
    } else {
      t.update(replyId, { content: text, ...(tools ? { tools } : {}) });
    }
  };
  const settle = () => {
    if (settled) return false;
    settled = true;
    off();
    // A stopped or failed reply leaves no tool spinning.
    if (tools?.some((x) => x.status === 'running')) {
      tools = tools.map((x) => (x.status === 'running' ? { ...x, status: 'error' as const } : x));
      show();
    }
    t.onSettled();
    return true;
  };
  const off = bridge.onStreamEvent((id, event) => {
    if (id !== requestId) return;
    if (settled) return;
    if (event.type === 'delta') {
      text += event.text;
      show();
      return;
    }
    if (event.type === 'tool') {
      const { id: toolId, server, tool, detail, status } = event;
      const use: ToolUse = { id: toolId, server, tool, ...(detail ? { detail } : {}), status };
      const list = tools ?? [];
      // Later events for a call only move its status (and add detail); the first one names it.
      tools = list.some((x) => x.id === toolId)
        ? list.map((x) => (x.id === toolId ? { ...x, status, ...(detail ? { detail } : {}) } : x))
        : [...list, use];
      show();
      return;
    }
    if (settle() && event.type === 'error') fail(event.message);
  });

  bridge.stream(requestId, payload(messages)).catch((err: unknown) => {
    if (settle()) fail(err instanceof Error ? err.message : `Could not reach ${provider}.`);
  });

  // Stopping keeps whatever text arrived and ignores anything still in flight.
  return () => {
    if (settle()) void bridge.abort(requestId);
  };
}
