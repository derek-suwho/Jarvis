// Shared validation for media crossing the renderer/provider IPC boundary.
const MAX_MESSAGES = 200;
const MAX_TEXT_CHARS = 400_000;
const MAX_MEDIA_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGE_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

function matchesSignature(bytes, type) {
  switch (type) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].some((signature) => bytes.subarray(0, 6).equals(Buffer.from(signature)));
    case 'image/webp':
      return bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from('RIFF'))
        && bytes.subarray(8, 12).equals(Buffer.from('WEBP'));
    case 'application/pdf':
      return bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
        && bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from('%%EOF'));
    default:
      return false;
  }
}

function validateMedia(file) {
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255
    || /[\u0000-\u001f\u007f]/.test(file.name)) {
    throw new Error('Invalid attachment filename. Use a name of up to 255 characters.');
  }
  if (!MEDIA_TYPES.has(file.type)) throw new Error(`${file.name} has an unsupported attachment type.`);
  const limit = file.type === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (typeof file.data !== 'string' || !file.data.length) {
    throw new Error(`The contents of ${JSON.stringify(file.name)} are unavailable. Attach the file again.`);
  }
  if (file.data.length > 4 * Math.ceil(limit / 3)) {
    throw new Error(`${file.name} is too large. Attach a smaller file.`);
  }
  if (file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) {
    throw new Error(`${file.name} has invalid attachment data. Attach the file again.`);
  }
  const bytes = Buffer.from(file.data, 'base64');
  if (bytes.length > limit) throw new Error(`${file.name} is too large. Attach a smaller file.`);
  if (bytes.toString('base64') !== file.data || !matchesSignature(bytes, file.type)) {
    throw new Error(`${file.name} is damaged or does not match its file type. Attach a valid file.`);
  }
  return { media: { name: file.name, type: file.type, data: file.data }, bytes: bytes.length };
}

/** Validates and copies messages; unknown fields never reach a provider. */
function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) {
    throw new Error('Invalid conversation.');
  }
  let textChars = 0;
  let serializedBytes = 2; // Array brackets; each subsequent message also adds a comma.
  return messages.map((message, index) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('Invalid message.');
    }
    textChars += message.content.length;
    if (textChars > MAX_TEXT_CHARS) throw new Error('Conversation is too long to send.');
    if (message.media !== undefined && !Array.isArray(message.media)) throw new Error('Invalid attachments.');
    if (message.media?.length > MAX_MEDIA_PER_MESSAGE) throw new Error('Up to 10 media files per message.');
    if (message.media?.length && message.role !== 'user') throw new Error('Only user messages can contain media attachments.');
    let mediaBytes = 0;
    const media = (message.media ?? []).map((file) => {
      const validated = validateMedia(file);
      mediaBytes += validated.bytes;
      if (mediaBytes > MAX_MESSAGE_MEDIA_BYTES) {
        throw new Error('Attachments are too large. Files can total up to 10 MB per message.');
      }
      return validated.media;
    });
    const clean = { role: message.role, content: message.content, ...(media.length ? { media } : {}) };
    serializedBytes += Buffer.byteLength(JSON.stringify(clean), 'utf8') + (index ? 1 : 0);
    if (serializedBytes > MAX_REQUEST_BYTES) {
      throw new Error('Conversation attachments are too large to send. Start a new chat or use smaller files.');
    }
    return clean;
  });
}

module.exports = { validateMessages, MAX_REQUEST_BYTES };
