// ChatGPT-plan inference over the Responses API using the signed-in account's token.
// Spec: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
const auth = require('./chatgpt-auth.cjs');

const API_BASE = 'https://api.openai.com/v1';
const MAX_MESSAGES = 200;
const MAX_CHARS = 400_000;

const USAGE_ERRORS = {
  subscription_sharing_usage_limit_exceeded:
    'You have reached your ChatGPT plan usage limit. Manage usage in your ChatGPT settings.',
  subscription_sharing_usage_unavailable: 'ChatGPT plan usage is not available for this account right now.',
};

/** Validates renderer input at the IPC boundary. Returns { model, input } or throws. */
function validateRequest(payload) {
  const { model, messages } = payload || {};
  if (typeof model !== 'string' || !/^[\w.:-]{1,100}$/.test(model)) throw new Error('Invalid model.');
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error('Invalid conversation.');
  }
  let total = 0;
  const input = messages.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new Error('Invalid message.');
    }
    total += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (total > MAX_CHARS) throw new Error('Conversation is too long to send.');
  return { model, input };
}

async function authedFetch(path, init) {
  let token = await auth.getAccessToken();
  const go = (t) => fetch(`${API_BASE}${path}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${t}` } });
  let res = await go(token);
  // An access token can be revoked or rotated early; refresh once and retry.
  if (res.status === 401) {
    token = await auth.getAccessToken({ forceRefresh: true });
    res = await go(token);
  }
  return res;
}

async function errorMessage(res) {
  let detail = '';
  try {
    const json = await res.json();
    detail = json?.error?.message || json?.error?.code || '';
  } catch {
    // Non-JSON error body.
  }
  if (res.status === 401) return 'Your ChatGPT session is no longer valid. Continue with ChatGPT to sign in again.';
  if (res.status === 429) return detail || 'ChatGPT is rate limiting requests. Try again shortly.';
  return `ChatGPT request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`;
}

/** Models available to the signed-in account: [{ slug, name }]. */
async function listModels() {
  const res = await authedFetch('/models', { method: 'GET' });
  if (!res.ok) throw new Error(await errorMessage(res));
  const json = await res.json();
  const items = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return items
    .filter((m) => m && m.visibility === 'list' && typeof (m.slug ?? m.id) === 'string')
    .map((m) => ({ slug: m.slug ?? m.id, name: m.display_name ?? m.slug ?? m.id }));
}

/** Yields parsed SSE `data:` payloads from a fetch response body. */
async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Ignore malformed keep-alive fragments.
      }
    }
  }
}

/**
 * Streams one response. `emit` receives { type: 'delta', text } and finally exactly one of
 * { type: 'done' } or { type: 'error', message }.
 */
async function streamResponse(payload, emit, signal) {
  let request;
  try {
    request = validateRequest(payload);
  } catch (err) {
    emit({ type: 'error', message: err.message });
    return;
  }
  try {
    const res = await authedFetch('/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model: request.model, input: request.input, store: false, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      emit({ type: 'error', message: await errorMessage(res) });
      return;
    }
    for await (const event of sseEvents(res.body)) {
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        emit({ type: 'delta', text: event.delta });
      } else if (event.type === 'response.completed') {
        emit({ type: 'done' });
        return;
      } else if (event.type === 'response.failed' || event.type === 'error') {
        const err = event.response?.error ?? event.error ?? {};
        emit({ type: 'error', message: USAGE_ERRORS[err.code] ?? err.message ?? 'ChatGPT could not complete the response.' });
        return;
      } else if (event.type === 'response.incomplete') {
        const reason = event.response?.incomplete_details?.reason;
        emit({ type: 'error', message: `The response stopped early${reason ? ` (${reason})` : ''}.` });
        return;
      }
    }
    // Only response.completed marks success.
    emit({ type: 'error', message: 'The connection to ChatGPT ended before the response finished.' });
  } catch (err) {
    if (signal?.aborted) emit({ type: 'error', message: 'Stopped.' });
    else emit({ type: 'error', message: err.message || 'Could not reach ChatGPT.' });
  }
}

function registerIpc(ipcMain) {
  const inflight = new Map();

  ipcMain.handle('chatgpt:models', () => listModels());

  ipcMain.handle('chatgpt:stream', (event, requestId, payload) => {
    if (typeof requestId !== 'string' || inflight.has(requestId)) return;
    const controller = new AbortController();
    inflight.set(requestId, controller);
    const sender = event.sender;
    const emit = (msg) => {
      if (!sender.isDestroyed()) sender.send('chatgpt:stream-event', requestId, msg);
    };
    streamResponse(payload, emit, controller.signal).finally(() => inflight.delete(requestId));
  });

  ipcMain.handle('chatgpt:abort', (_event, requestId) => inflight.get(requestId)?.abort());
}

module.exports = { registerIpc, validateRequest, sseEvents, USAGE_ERRORS };
