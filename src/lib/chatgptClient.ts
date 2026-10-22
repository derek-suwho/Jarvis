import type { Message } from './chats';
import { newId } from './chats';
import type { ChatGPTModel } from './desktop';

interface ReplyTarget {
  /** Model slug sent to the Responses API. */
  model: string;
  /** Label stored on the reply (shown above it). */
  label: string;
  /** Conversation so far, oldest first, ending with the new user message. */
  history: Message[];
  append: (msg: Message) => void;
  update: (id: string, content: string) => void;
  /** Called once when the first text arrives. */
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
  const bridge = window.jarvis?.chatgpt;
  const fail = (message: string) =>
    t.append({ id: newId(), role: 'assistant', content: message, model: t.label, error: true });
  if (!bridge) {
    fail('ChatGPT is only available in the Jarvis desktop app.');
    t.onSettled();
    return () => {};
  }

  const requestId = newId();
  const replyId = t.replyId ?? newId();
  let text = '';
  let started = false;
  let settled = false;
  const settle = () => {
    if (settled) return false;
    settled = true;
    off();
    t.onSettled();
    return true;
  };
  const messages = t.history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));

  const off = bridge.onStreamEvent((id, event) => {
    if (id !== requestId) return;
    if (settled) return;
    if (event.type === 'delta') {
      text += event.text;
      if (!started) {
        started = true;
        t.onFirstToken?.();
        t.append({ id: replyId, role: 'assistant', content: text, model: t.label });
      } else {
        t.update(replyId, text);
      }
      return;
    }
    if (settle() && event.type === 'error') fail(event.message);
  });

  bridge.stream(requestId, { model: t.model, messages }).catch((err: unknown) => {
    if (settle()) fail(err instanceof Error ? err.message : 'Could not reach ChatGPT.');
  });

  // Stopping keeps whatever text arrived and ignores anything still in flight.
  return () => {
    if (settle()) void bridge.abort(requestId);
  };
}
