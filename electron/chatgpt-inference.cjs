// ChatGPT-plan inference over the Responses API using the signed-in account's token.
// Spec: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
const auth = require('./chatgpt-auth.cjs');
const tools = require('./tools/index.cjs');
const { RENDERING_GUIDE } = require('./rendering-guide.cjs');
const { validateMessages, MAX_REQUEST_BYTES } = require('./media-input.cjs');

const API_BASE = 'https://api.openai.com/v1';
const MAX_TOOL_ROUNDS = 8;
const MAX_GENERATED_BYTES = 4 * 1024 * 1024;
const INTERRUPTED_PREFIX = '[This response was interrupted before completion.]\n';
const NOT_EXECUTED = 'Not executed: the user interrupted this plan before the tool started.';

const USAGE_ERRORS = {
  subscription_sharing_usage_limit_exceeded:
    'You have reached your ChatGPT plan usage limit. Manage usage in your ChatGPT settings.',
  subscription_sharing_usage_unavailable: 'ChatGPT plan usage is not available for this account right now.',
};

/** Validates renderer input at the IPC boundary. Returns { model, input } or throws. */
function validateRequest(payload) {
  const { model, messages } = payload || {};
  if (typeof model !== 'string' || !/^[\w.:-]{1,100}$/.test(model)) throw new Error('Invalid model.');
  const input = validateMessages(messages).map((message) => {
    if (!message.media?.length) return { role: message.role, content: message.content };
    const content = message.content ? [{ type: 'input_text', text: message.content }] : [];
    for (const file of message.media) {
      const dataUrl = `data:${file.type};base64,${file.data}`;
      if (file.type === 'application/pdf') {
        content.push({ type: 'input_file', filename: file.name, file_data: dataUrl });
      } else {
        content.push({ type: 'input_text', text: `Attached image: ${JSON.stringify(file.name)}` });
        content.push({ type: 'input_image', image_url: dataUrl });
      }
    }
    return { role: message.role, content };
  });
  return { model, input };
}

async function authedFetch(path, init) {
  let token = await auth.getAccessToken();
  const go = (t) => {
    init?.signal?.throwIfAborted();
    return fetch(`${API_BASE}${path}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${t}` } });
  };
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

/** Jarvis tools (MCP servers and skills) as Responses API function tools. */
function functionTools(catalog) {
  return catalog.map((t) => {
    const { $schema, ...parameters } = t.parameters ?? {};
    return { type: 'function', name: t.name, description: t.description, parameters, strict: false };
  });
}

async function runCall(catalog, call) {
  return (await runCallOutcome(catalog, call)).output;
}

/** A rejected transport may have performed the action; do not turn it into a retryable model error. */
async function runCallOutcome(catalog, call) {
  const tool = catalog.find((t) => t.name === call.name);
  if (!tool) return { output: `Unknown tool ${call.name}.`, failed: true };
  let args;
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    return { output: 'Tool arguments were not valid JSON.', failed: true };
  }
  try {
    const output = await tool.run(args);
    return { output: typeof output === 'string' ? output : JSON.stringify(output ?? null), failed: /^Error:/.test(output) };
  } catch (err) {
    return { output: `Error: ${err.message || 'the tool failed.'}`, failed: true, uncertainEffects: true };
  }
}

/** Chat activity event for a tool call; skills show which skill they load. */
function toolEvent(catalog, call, status) {
  const tool = catalog.find((t) => t.name === call.name);
  let detail;
  if (tool?.server === 'Skills') {
    try {
      detail = JSON.parse(call.arguments || '{}').name;
    } catch {
      // Unparseable arguments just show no detail.
    }
  }
  return {
    type: 'tool',
    id: call.call_id,
    server: tool?.server ?? 'Tools',
    tool: tool?.tool ?? call.name,
    ...(typeof detail === 'string' ? { detail } : {}),
    status,
  };
}

/** The caller owns the checkpoint so interruption cannot discard received text or planned calls. */
async function streamTurn(model, input, toolDefs, emit, signal, checkpoint) {
  signal.throwIfAborted();
  const body = JSON.stringify({ model, instructions: RENDERING_GUIDE, input, store: false, stream: true, ...(toolDefs.length ? { tools: toolDefs, tool_choice: 'auto' } : {}) });
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new Error('Conversation and tool context are too large to send. Start a new chat or use smaller files.');
  }
  const res = await authedFetch('/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body,
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await errorMessage(res));
  }
  for await (const event of sseEvents(res.body)) {
    signal.throwIfAborted();
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      emit({ type: 'delta', text: event.delta });
      checkpoint.text += event.delta;
    } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const { call_id: callId, name, arguments: args } = event.item;
      if (typeof callId !== 'string' || typeof name !== 'string' || typeof args !== 'string') {
        throw new Error('ChatGPT returned an invalid tool call.');
      }
      if (!checkpoint.calls.some((call) => call.call_id === callId)) {
        checkpoint.calls.push({ call_id: callId, name, arguments: args });
      }
    } else if (event.type === 'response.completed') {
      checkpoint.complete = true;
      return;
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const err = event.response?.error ?? event.error ?? {};
      throw new Error(USAGE_ERRORS[err.code] ?? err.message ?? 'ChatGPT could not complete the response.');
    } else if (event.type === 'response.incomplete') {
      const reason = event.response?.incomplete_details?.reason;
      throw new Error(`The response stopped early${reason ? ` (${reason})` : ''}.`);
    }
  }
  // Only response.completed marks success.
  throw new Error('The connection to ChatGPT ended before the response finished.');
}

/**
 * One task attempt. Only delta/tool events cross `emit`; `settled` owns the lifecycle.
 * Interrupt/stop abort HTTP, but wait for an already-dispatched tool to settle before releasing the slot.
 * Continuation stays in main and preserves native tool pairs instead of replaying external actions.
 * @param {{ request: *, continuation?: *, updates?: import('../src/lib/replyContext').ReplyMessage[], attemptId?: string }} options
 */
function openAttempt({ request, continuation, updates = [] }, emit, getTools = tools.catalog) {
  const lifetime = new AbortController();
  let http = null;
  let finished = false;
  let input = [];
  let generatedBytes = 0;
  let checkpoint = null;
  const cancel = () => {
    if (finished) return;
    lifetime.abort();
    http?.abort();
  };
  const countGeneratedBytes = (bytes) => {
    if (generatedBytes + bytes > MAX_GENERATED_BYTES) {
      const error = new Error('Task output and tool context exceeded the 4 MiB limit. Partial output has been kept.');
      error.code = 'TASK_CONTEXT_LIMIT';
      throw error;
    }
    generatedBytes += bytes;
  };
  const countGenerated = (value) => countGeneratedBytes(Buffer.byteLength(value, 'utf8'));
  const appendGenerated = (item) => {
    countGenerated(JSON.stringify(item));
    input.push(item);
  };
  const saveText = () => {
    if (!checkpoint?.text) return;
    // Text deltas are already counted; count only the serialized envelope and interruption label here.
    const content = (checkpoint.complete ? '' : INTERRUPTED_PREFIX) + checkpoint.text;
    const item = { role: 'assistant', content };
    countGeneratedBytes(Buffer.byteLength(JSON.stringify(item), 'utf8') - Buffer.byteLength(checkpoint.text, 'utf8'));
    input.push(item);
    checkpoint.text = '';
  };
  const cancelRemaining = (calls) => {
    for (const call of calls) {
      appendGenerated({ type: 'function_call', ...call });
      appendGenerated({ type: 'function_call_output', call_id: call.call_id, output: NOT_EXECUTED });
    }
  };
  const snapshot = () => ({ provider: 'chatgpt', model: request?.model, input: structuredClone(input), generatedBytes });
  const settled = (async () => {
    try {
      const clean = validateRequest({ ...request, messages: [...(request?.messages ?? []), ...updates] });
      if (updates.some((message) => message.role !== 'user')) throw new Error('Queued messages must be user messages.');
      if (continuation) {
        if (continuation.provider !== 'chatgpt' || continuation.model !== clean.model || !Array.isArray(continuation.input)
          || !Number.isSafeInteger(continuation.generatedBytes) || continuation.generatedBytes < 0
          || continuation.generatedBytes > MAX_GENERATED_BYTES) {
          throw new Error('Invalid ChatGPT task continuation.');
        }
        input = structuredClone(continuation.input);
        generatedBytes = continuation.generatedBytes;
        if (updates.length) input.push(...validateRequest({ model: clean.model, messages: updates }).input);
      } else {
        input = clean.input;
      }
      if (lifetime.signal.aborted) return { kind: 'interrupted', continuation: snapshot() };
      let catalog = [];
      try {
        catalog = await getTools();
      } catch {
        // A broken tools setup never blocks a plain reply.
      }
      const toolDefs = functionTools(catalog);
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (lifetime.signal.aborted) return { kind: 'interrupted', continuation: snapshot() };
        checkpoint = { text: '', calls: [], complete: false };
        http = new AbortController();
        try {
          await streamTurn(clean.model, input, toolDefs, (event) => {
            if (lifetime.signal.aborted) return;
            countGenerated(event.text);
            emit(event);
          }, http.signal, checkpoint);
        } finally {
          http = null;
        }
        const hadText = Boolean(checkpoint.text);
        saveText();
        const calls = checkpoint.calls;
        checkpoint = null;
        if (lifetime.signal.aborted) {
          cancelRemaining(calls);
          return { kind: 'interrupted', continuation: snapshot() };
        }
        if (!calls.length) return { kind: 'complete', continuation: snapshot() };
        for (let index = 0; index < calls.length; index++) {
          if (lifetime.signal.aborted) {
            cancelRemaining(calls.slice(index));
            return { kind: 'interrupted', continuation: snapshot() };
          }
          const call = calls[index];
          appendGenerated({ type: 'function_call', ...call });
          emit(toolEvent(catalog, call, 'running'));
          if (lifetime.signal.aborted) {
            appendGenerated({ type: 'function_call_output', call_id: call.call_id, output: NOT_EXECUTED });
            emit(toolEvent(catalog, call, 'error'));
            cancelRemaining(calls.slice(index + 1));
            return { kind: 'interrupted', continuation: snapshot() };
          }
          const outcome = await runCallOutcome(catalog, call);
          emit(toolEvent(catalog, call, outcome.failed ? 'error' : 'done'));
          appendGenerated({ type: 'function_call_output', call_id: call.call_id, output: outcome.output });
          if (outcome.uncertainEffects) {
            cancelRemaining(calls.slice(index + 1));
            return {
              kind: 'failed', uncertainEffects: true, continuation: snapshot(),
              error: 'A tool outcome could not be confirmed. Check its result before retrying; queued instructions were not resumed.',
            };
          }
        }
        if (hadText && !lifetime.signal.aborted) {
          countGenerated('\n\n');
          emit({ type: 'delta', text: '\n\n' });
        }
      }
      if (lifetime.signal.aborted) return { kind: 'interrupted', continuation: snapshot() };
      return { kind: 'failed', error: 'Stopped after too many tool calls in one reply.', continuation: snapshot() };
    } catch (err) {
      // Preserve a valid protocol checkpoint, even if interruption arrived before response.completed.
      if (checkpoint) {
        try {
          saveText();
          cancelRemaining(checkpoint.calls);
        } catch {
          // The size limit takes precedence; already-emitted fragments remain in the task projection.
          return { kind: 'failed', error: err.message || 'Task context exceeded its limit.' };
        }
      }
      if (lifetime.signal.aborted && err.code !== 'TASK_CONTEXT_LIMIT') return { kind: 'interrupted', continuation: snapshot() };
      return { kind: 'failed', error: err.message || 'Could not reach ChatGPT.', continuation: snapshot() };
    } finally {
      finished = true;
      http?.abort();
      http = null;
    }
  })();
  return { settled, interrupt: cancel, stop: cancel };
}

/** Legacy renderer transport, kept compatible while tasks take ownership of lifecycle. */
async function streamResponse(payload, emit, signal, getTools = tools.catalog) {
  const attempt = openAttempt({ request: payload, updates: [] }, emit, getTools);
  const abort = () => attempt.stop();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const result = await attempt.settled;
    emit(result.kind === 'complete' ? { type: 'done' } : {
      type: 'error', message: result.kind === 'interrupted' ? 'Stopped.' : result.error,
    });
  } finally {
    signal?.removeEventListener('abort', abort);
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

module.exports = { registerIpc, validateRequest, sseEvents, functionTools, runCall, toolEvent, streamResponse, openAttempt, USAGE_ERRORS };
