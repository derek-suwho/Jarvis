import { useEffect, useRef, useState } from 'react';
import type { Attachment, Chat } from './lib/chats';
import { appendMessage, mockReply, newId, streamChunks, updateMessage } from './lib/chats';

const THINK_MS = 450;
const CHUNK_MS = 35;

type SetChats = (fn: (cs: Chat[]) => Chat[]) => void;

/**
 * Simulated streaming until provider adapters exist: a short "thinking" pause,
 * then the reply arrives a few words at a time. Stopping keeps what arrived.
 */
export function useReplyStream(setChats: SetChats) {
  const [streaming, setStreaming] = useState<{ chatId: string; messageId: string } | null>(null);
  const timers = useRef<{ timeout?: number; interval?: number }>({});
  const current = useRef(streaming);
  current.current = streaming;

  const clear = () => {
    window.clearTimeout(timers.current.timeout);
    window.clearInterval(timers.current.interval);
    timers.current = {};
  };
  useEffect(() => clear, []);

  const stop = () => {
    const s = current.current;
    clear();
    setStreaming(null);
    if (!s) return;
    // Drop the placeholder if nothing arrived yet.
    setChats((cs) =>
      cs.map((c) =>
        c.id !== s.chatId ? c : { ...c, messages: c.messages.filter((m) => !(m.id === s.messageId && !m.content)) },
      ),
    );
  };

  const start = (chatId: string, prompt: string, model: string, attachments: Attachment[] = []) => {
    clear();
    const messageId = newId();
    const chunks = streamChunks(mockReply(prompt, model, attachments));
    setStreaming({ chatId, messageId });
    timers.current.timeout = window.setTimeout(() => {
      setChats((cs) => appendMessage(cs, chatId, { id: messageId, role: 'assistant', content: '', model }));
      let i = 0;
      timers.current.interval = window.setInterval(() => {
        i++;
        setChats((cs) => updateMessage(cs, chatId, messageId, { content: chunks.slice(0, i).join('') }));
        if (i >= chunks.length) {
          clear();
          setStreaming(null);
        }
      }, CHUNK_MS);
    }, THINK_MS);
  };

  return { streaming, start, stop };
}
