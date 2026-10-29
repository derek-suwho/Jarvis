import type { Message } from './chats';
import { MAX_FILES, MAX_REQUEST_BYTES, MAX_TOTAL_FILE_BYTES, mediaType, validateMediaData } from './attachments';

export interface ReplyMedia {
  name: string;
  type: string;
  data: string;
}

export interface ReplyMessage {
  role: 'user' | 'assistant';
  content: string;
  media?: ReplyMedia[];
}

/** Keeps both user-authored scopes explicit without upgrading them to system instructions. */
export function composeInstructions(personal: string, project?: string): string {
  const preferences = personal.trim();
  const scoped = project?.trim();
  const sections: string[] = [];

  if (preferences) sections.push(`Personal preferences:\n${preferences}`);
  if (scoped) sections.push(`Project instructions:\n${scoped}`);
  if (preferences && scoped) {
    sections.unshift('Project instructions take precedence over personal preferences when they conflict.');
  }

  return sections.join('\n\n');
}

/** Includes original media on every turn that owns it, including replay after model switches. */
export function buildReplyHistory(history: Message[], instructions?: string): ReplyMessage[] {
  let pendingInstructions = instructions?.trim();

  const messages = history.filter((message) => !message.error &&
    (!message.delivery || message.delivery === 'applied') &&
    (!message.outcome || message.outcome === 'complete')).map((message) => {
    let content = message.content;
    const media: ReplyMedia[] = [];
    let mediaBytes = 0;

    for (const attachment of message.attachments ?? []) {
      const type = mediaType(attachment);
      if (type && typeof attachment.data === 'string') {
        if (message.role !== 'user') throw new Error('Media attachments must belong to a user message.');
        const file = { name: attachment.name, type, data: attachment.data };
        mediaBytes += validateMediaData(file);
        media.push(file);
        continue;
      }
      if (typeof attachment.text !== 'string') {
        throw new Error(
          `The contents of ${JSON.stringify(attachment.name)} are unavailable in this saved chat. ` +
          'Start a new chat and attach the file again, or paste its contents into your message.',
        );
      }
      content += `\n\n--- Attached file: ${JSON.stringify(attachment.name)} ---\n${attachment.text}\n--- End attached file ---`;
    }

    if (media.length > MAX_FILES || mediaBytes > MAX_TOTAL_FILE_BYTES) {
      throw new Error('A message can contain up to 10 files totaling 10 MB. Remove some attachments. Your draft is still here.');
    }

    if (pendingInstructions && message.role === 'user') {
      content = `User-provided instructions for this conversation:\n${pendingInstructions}\n\nUser message:\n${content}`;
      pendingInstructions = undefined;
    }

    return { role: message.role, content, ...(media.length ? { media } : {}) };
  });

  if (messages.length > 200 || messages.reduce((total, message) => total + message.content.length, 0) > 400_000) {
    throw new Error('This conversation is too long to send. Start a new chat or remove some attached files. Your draft is still here.');
  }
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > MAX_REQUEST_BYTES) {
    throw new Error('This conversation is too large to send (20 MB limit). Start a new chat or remove some attached files. Your draft is still here.');
  }
  return messages;
}
