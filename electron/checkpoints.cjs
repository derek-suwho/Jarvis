// JSON bounds apply before parsing; no paths or database handles cross IPC.
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const mediaBytes = (a) => ['data', 'preview', 'text'].reduce((bytes, key) =>
  bytes + (typeof a[key] === 'string' ? Buffer.byteLength(a[key], 'utf8') : 0), 0);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value, keys) => keys.every((key) => value[key] === undefined || typeof value[key] === 'string');
const flags = (value, keys) => keys.every((key) => value[key] === undefined || typeof value[key] === 'boolean');
const optionalArray = (value, key, valid) => value[key] === undefined || (Array.isArray(value[key]) && value[key].every(valid));
const attachment = (a) => object(a) && typeof a.id === 'string' && typeof a.name === 'string'
  && typeof a.type === 'string' && Number.isFinite(a.size) && a.size >= 0 && strings(a, ['data', 'preview', 'text']) && mediaBytes(a) <= MAX_ATTACHMENT_BYTES;
const tool = (t) => object(t) && ['id', 'server', 'tool'].every((key) => typeof t[key] === 'string')
  && strings(t, ['detail']) && ['running', 'done', 'error'].includes(t.status);
const message = (m) => object(m) && typeof m.id === 'string' && typeof m.content === 'string'
  && ['user', 'assistant'].includes(m.role) && strings(m, ['model', 'taskId', 'attemptId']) && flags(m, ['error'])
  && (m.taskRevision === undefined || (Number.isSafeInteger(m.taskRevision) && m.taskRevision >= 0))
  && (m.feedback === undefined || ['up', 'down'].includes(m.feedback))
  && (m.outcome === undefined || ['complete', 'interrupted', 'cancelled', 'failed'].includes(m.outcome))
  && (m.delivery === undefined || ['queued', 'applying', 'applied', 'cancelled'].includes(m.delivery))
  && optionalArray(m, 'attachments', attachment) && optionalArray(m, 'tools', tool);
const chat = (c) => object(c) && typeof c.id === 'string' && typeof c.title === 'string'
  && Number.isFinite(c.updatedAt) && Array.isArray(c.messages) && c.messages.every(message)
  && strings(c, ['projectId', 'taskGeneration']) && flags(c, ['pinned', 'archived', 'temporary']);

function registerCheckpointIpc(ipc, checkpoints) {
  ipc.handle('checkpoints:load', () => {
    const chats = checkpoints.load();
    if (chats === null) return null;
    if (!Array.isArray(chats) || !chats.every(chat)) {
      throw new Error('Invalid checkpoint archive.');
    }
    // Legacy archives can retain image previews alongside their source bytes.
    // Project a fresh response; the renderer reconstructs these exact previews.
    const restored = chats.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m,
      ...(m.attachments ? { attachments: m.attachments.map(a => {
        if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(a.type) && a.data !== undefined
          && a.preview === `data:${a.type};base64,${a.data}`) {
          const { preview, ...media } = a;
          return media;
        }
        return a;
      }) } : {}),
    })) }));
    // Apply transport bounds after removing only reconstructible duplication.
    if (Buffer.byteLength(JSON.stringify(restored), 'utf8') > MAX_CHECKPOINT_BYTES) {
      throw new Error('Invalid checkpoint archive.');
    }
    return restored;
  });
  ipc.handle('checkpoints:save', (_event, serialized) => {
    let chats;
    try {
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_CHECKPOINT_BYTES) throw new Error();
      chats = JSON.parse(serialized);
      if (!Array.isArray(chats) || !chats.every(chat)) throw new Error();
    } catch {
      throw new Error('Invalid checkpoint archive.');
    }
    checkpoints.save(chats);
    return true;
  });
}
module.exports = { registerCheckpointIpc };
