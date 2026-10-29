const { validateMessages } = require('../media-input.cjs');

function replyMessages(history, instructions = '') {
  if (!Array.isArray(history)) throw new Error('Invalid conversation.');
  let pending = typeof instructions === 'string' ? instructions.trim() : '';
  const messages = history.filter((m) => !m.error && !['queued', 'applying', 'cancelled'].includes(m.delivery)).map((m) => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('Invalid message.');
    let content = m.content;
    const media = [];
    if (m.attachments !== undefined && !Array.isArray(m.attachments)) throw new Error('Invalid attachments.');
    if (m.attachments?.length > 10) throw new Error('Up to 10 files per message.');
    for (const file of m.attachments ?? []) {
      if (typeof file?.name !== 'string') throw new Error('Invalid attachment.');
      if (typeof file.data === 'string') media.push({ name: file.name, type: file.type, data: file.data });
      else if (typeof file.text === 'string') content += `\n\n--- Attached file: ${JSON.stringify(file.name)} ---\n${file.text}\n--- End attached file ---`;
      else throw new Error(`The contents of ${JSON.stringify(file.name)} are unavailable. Attach the file again.`);
    }
    if (m.role === 'assistant' && m.outcome && m.outcome !== 'complete') content = `[Incomplete ${m.outcome} response]\n${content}`;
    if (pending && m.role === 'user') {
      content = `User-provided instructions for this conversation:\n${pending}\n\nUser message:\n${content}`;
      pending = '';
    }
    return { role: m.role, content, ...(media.length ? { media } : {}) };
  });
  return validateMessages(messages);
}

function userMessage(message) {
  if (!message || typeof message.id !== 'string' || !/^[\w:-]{1,120}$/.test(message.id)
    || message.role !== 'user' || typeof message.content !== 'string'
    || (!message.content.trim() && !message.attachments?.length)) throw new Error('Invalid user message.');
  const clean = { id: message.id, role: 'user', content: message.content,
    ...(message.attachments?.length ? { attachments: structuredClone(message.attachments) } : {}) };
  replyMessages([clean]);
  return clean;
}

module.exports = { replyMessages, userMessage };
