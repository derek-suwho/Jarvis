// Claude via the user's own, unmodified Claude Code CLI. Sign-in happens only in Claude Code's own flow
// (`claude auth login`); Jarvis never reads or stores Claude credentials.
// Terms: https://code.claude.com/docs/en/legal-and-compliance
const { app } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const timers = require('node:timers');
const tools = require('./tools/index.cjs');
const { RENDERING_GUIDE } = require('./rendering-guide.cjs');
const { validateMessages } = require('./media-input.cjs');

const CHAT_SYSTEM_PROMPT = [
  'You are Claude, chatting with the user inside Jarvis, a desktop chat app.',
  'Be a helpful, thoughtful general-purpose assistant: answer directly, use Markdown when it helps',
  '(headings, lists, tables, fenced code), and match the depth of your answer to the question.',
  'You have no access to the user\'s files or computer in this mode, apart from any tools you are given.',
].join(' ') + `\n\n${RENDERING_GUIDE}`;

const EFFORT = { None: 'low', Low: 'low', Medium: 'medium', High: 'high', 'Extra High': 'xhigh', Max: 'max' };

let binaryPath = null;

/** Finds the installed `claude` binary; GUI apps don't inherit the shell PATH. */
async function findClaude() {
  if (binaryPath && fs.existsSync(binaryPath)) return binaryPath;
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  binaryPath = candidates.find((p) => fs.existsSync(p)) ?? null;
  if (!binaryPath) {
    const shell = process.env.SHELL || '/bin/zsh';
    binaryPath = await new Promise((resolve) =>
      execFile(shell, ['-lc', 'command -v claude'], { timeout: 5000 }, (err, out) =>
        resolve(err ? null : out.trim().split('\n').pop() || null),
      ),
    );
  }
  return binaryPath;
}

function run(bin, args, timeout = 15000) {
  return new Promise((resolve) =>
    execFile(bin, args, { timeout, cwd: workspace() }, (err, stdout) => resolve({ err, stdout })),
  );
}

/** Empty working directory so Claude Code never runs inside an unrelated project. */
function workspace() {
  const dir = path.join(app.getPath('userData'), 'claude-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function status() {
  const bin = await findClaude();
  if (!bin) return { installed: false, connected: false, email: null, plan: null };
  const { err, stdout } = await run(bin, ['auth', 'status', '--json']);
  let s = {};
  try {
    s = JSON.parse(stdout);
  } catch {
    // Not logged in or unexpected output.
  }
  return {
    installed: true,
    connected: !err && !!s.loggedIn,
    email: s.email ?? null,
    plan: s.subscriptionType ?? null,
    method: s.authMethod ?? null,
  };
}

/** Opens Claude Code's own login in a terminal window so the user signs in with Anthropic directly. */
async function signIn() {
  const bin = await findClaude();
  if (!bin) return { ok: false, error: 'Claude Code is not installed. Install it from claude.com/claude-code first.' };
  if (process.platform === 'darwin') {
    const quoted = bin.replace(/(["\\])/g, '\\$1');
    const script = `tell application "Terminal"\n activate\n do script "\\"${quoted}\\" auth login"\nend tell`;
    await new Promise((resolve) => execFile('osascript', ['-e', script], () => resolve()));
  } else {
    spawn(bin, ['auth', 'login'], { detached: true, stdio: 'ignore' }).unref();
  }
  return { ok: true };
}

/** Signs out of Claude Code itself (`claude auth logout`), which also signs out the user's terminal. */
async function signOut() {
  const bin = await findClaude();
  if (!bin) return { ok: false, error: 'Claude Code is not installed.' };
  const { err } = await run(bin, ['auth', 'logout']);
  return err ? { ok: false, error: 'Claude Code could not sign out. Try `claude auth logout` in Terminal.' } : { ok: true };
}

/** Validates renderer input at the IPC boundary. */
function validateRequest(payload) {
  const { model, messages, mode, reasoning, conversationId } = payload || {};
  if (typeof model !== 'string' || !/^[\w.:-]{1,100}$/.test(model)) throw new Error('Invalid model.');
  if (mode !== 'chat' && mode !== 'code') throw new Error('Invalid mode.');
  if (typeof conversationId !== 'string' || !/^[\w-]{1,80}$/.test(conversationId)) throw new Error('Invalid conversation.');
  const clean = validateMessages(messages);
  if (clean[clean.length - 1].role !== 'user') throw new Error('The last message must be from the user.');
  return { model, mode, effort: EFFORT[reasoning] ?? null, conversationId, messages: clean };
}

const digest = (messages) => crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');

/** Native Claude content; text-only messages retain the original string contract. */
function messageContent(message) {
  if (!message.media?.length) return message.content;
  const content = message.content ? [{ type: 'text', text: message.content }] : [];
  for (const file of message.media) {
    const source = { type: 'base64', media_type: file.type, data: file.data };
    if (file.type === 'application/pdf') {
      content.push({ type: 'document', title: file.name, source });
    } else {
      content.push({ type: 'text', text: `Attached image: ${JSON.stringify(file.name)}` });
      content.push({ type: 'image', source });
    }
  }
  return content;
}

/** Prior turns as a transcript, for when Jarvis's history no longer matches a Claude Code session. */
function transcriptPrompt(messages) {
  const prior = messages.slice(0, -1);
  const latest = messageContent(messages[messages.length - 1]);
  if (prior.length === 0) return latest;
  if (messages.some((message) => message.media?.length)) {
    const blocks = [{ type: 'text', text: '<conversation_so_far>\n' }];
    for (const message of prior) {
      blocks.push({ type: 'text', text: `<${message.role}>\n` });
      const content = messageContent(message);
      blocks.push(...(typeof content === 'string' ? (content ? [{ type: 'text', text: content }] : []) : content));
      blocks.push({ type: 'text', text: `\n</${message.role}>\n` });
    }
    blocks.push({ type: 'text', text: "</conversation_so_far>\n\nContinue the conversation. The user's new message:\n\n" });
    blocks.push(...(typeof latest === 'string' ? (latest ? [{ type: 'text', text: latest }] : []) : latest));
    return blocks;
  }
  const lines = prior.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n');
  return `<conversation_so_far>\n${lines}\n</conversation_so_far>\n\nContinue the conversation. The user's new message:\n\n${latest}`;
}

/**
 * Jarvis owns the history; Claude Code sessions are a cache. When the history before the new message
 * exactly matches what a session has seen, resume it with just the new message; otherwise (edits,
 * regenerations, model or mode switches) start a fresh session from a transcript.
 */
const sessions = new Map(); // conversationId -> { sessionId, digest, mode, model }

/** Remembers that `sessionId` now holds this conversation plus the reply, so the next turn can resume it. */
function recordSession(req, sessionId, replyText) {
  const replied = [...req.messages, { role: 'assistant', content: replyText }];
  sessions.set(req.conversationId, { sessionId, digest: digest(replied), mode: req.mode, model: req.model });
}

/**
 * @param {{ file: string, names: string[] } | null} [mcp] Jarvis's tools layer (see tools/index.cjs), or null when nothing is set up.
 */
function buildArgs(req, mcp = null, continuation = null) {
  const prior = req.messages.slice(0, -1);
  const cached = sessions.get(req.conversationId);
  const resume = continuation || (
    cached && cached.mode === req.mode && cached.model === req.model && cached.digest === digest(prior) ? cached : null
  );
  const sessionId = resume ? resume.sessionId : crypto.randomUUID();
  const content = continuation ? continuation.content : (
    resume ? messageContent(req.messages[req.messages.length - 1]) : transcriptPrompt(req.messages)
  );
  const prompt = typeof content === 'string' ? content : JSON.stringify({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content },
  }) + '\n';

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', req.model];
  if (typeof content !== 'string') args.push('--input-format', 'stream-json');
  args.push(...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]));
  if (req.effort) args.push('--effort', req.effort);
  if (req.mode === 'chat') {
    // Plain chat: Jarvis's system prompt, no built-in tools, and none of the user's hooks or CLAUDE.md.
    args.push('--system-prompt', CHAT_SYSTEM_PROMPT, '--tools', '', '--setting-sources', '');
  } else {
    // Code mode keeps Claude Code's own prompt; its replies still show in Jarvis's chat.
    args.push('--append-system-prompt', RENDERING_GUIDE);
  }
  if (mcp) {
    // Jarvis's imported servers and skills; chat mode sees only these, code mode adds them to the user's own.
    args.push('--mcp-config', mcp.file, '--allowedTools', mcp.names.map((n) => `mcp__${n}`).join(','));
    if (req.mode === 'chat') args.push('--strict-mcp-config');
  }
  // Code mode keeps Claude Code's defaults; other tools needing approval are denied in print mode.
  return { args, prompt, sessionId };
}

/** Chat activity events for tool calls in one stream-json line: a call starting, or its result coming back. */
function toolEvents(e, labelTool) {
  const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
  if (e.type === 'assistant') {
    return blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const label = labelTool(b.name);
        const detail = label.server === 'Skills' && typeof b.input?.name === 'string' ? { detail: b.input.name } : {};
        return { type: 'tool', id: b.id, ...label, ...detail, status: 'running' };
      });
  }
  if (e.type === 'user') {
    return blocks
      .filter((b) => b.type === 'tool_result')
      // Results only carry the call id; the renderer keeps the name from the start event.
      .map((b) => ({ type: 'tool', id: b.tool_use_id, server: '', tool: '', status: b.is_error ? 'error' : 'done' }));
  }
  return [];
}

const INTERRUPT_GRACE_MS = 5000;
const MAX_TASK_OUTPUT_BYTES = 4 * 1024 * 1024;
const unknownOutcome = /timed?\s*out|timeout|connection.{0,30}(lost|closed|reset)|ECONNRESET|EPIPE|interrupt|abort|cancel/i;

/** Several queued instructions form one new CLI turn, retaining FIFO order and native media blocks. */
function queuedContent(messages) {
  if (messages.length === 1) return messageContent(messages[0]);
  if (!messages.some((message) => message.media?.length)) {
    return messages.map((message, index) => `Queued message ${index + 1}:\n${message.content}`).join('\n\n');
  }
  return messages.flatMap((message, index) => {
    const content = messageContent(message);
    return [
      { type: 'text', text: `${index ? '\n\n' : ''}Queued message ${index + 1}:\n` },
      ...(typeof content === 'string' ? [{ type: 'text', text: content }] : content),
    ];
  });
}

/**
 * A CLI attempt settles only after its process exits. SIGINT requests a resumable turn boundary;
 * SIGTERM stops work. A returned continuation is main-process data, never renderer input.
 */
function openAttempt({ request, continuation, updates = [], emitResultText = true }, emit) {
  let resolveSettled;
  const settled = new Promise((resolve) => { resolveSettled = resolve; });
  let child = null;
  let req = null;
  let sessionId = null;
  let sessionConfirmed = false;
  let sessionMismatch = false;
  let interrupted = false;
  let stopped = false;
  let finished = false;
  let result = null;
  let failure = null;
  let uncertainEffects = false;
  let graceTimer = null;
  let killTimer = null;
  let text = '';
  let stderr = '';
  let buffer = '';
  let toolBytes = 0;
  const pendingTools = new Set();
  const listeners = [];

  const finish = (outcome) => {
    if (finished) return;
    finished = true;
    timers.clearTimeout(graceTimer);
    timers.clearTimeout(killTimer);
    for (const [target, event, listener] of listeners) target.removeListener(event, listener);
    if (outcome.kind !== 'complete' && req) sessions.delete(req.conversationId);
    resolveSettled(outcome);
  };
  const on = (target, event, listener) => {
    target.on(event, listener);
    listeners.push([target, event, listener]);
  };
  const kill = (signal) => {
    try {
      child?.kill(signal);
    } catch (error) {
      failure ||= `Could not stop Claude Code: ${error.message}`;
      uncertainEffects = true;
    }
  };
  const terminate = () => {
    timers.clearTimeout(graceTimer);
    kill('SIGTERM');
    if (!killTimer) {
      killTimer = timers.setTimeout(() => { if (!finished) kill('SIGKILL'); }, INTERRUPT_GRACE_MS);
      killTimer.unref?.();
    }
  };
  const savedContinuation = (pending = false) => ({
    provider: 'claude', version: 1, sessionId: pending ? null : sessionId,
    pending, model: req.model, mode: req.mode, conversationId: req.conversationId,
    messages: [...req.messages, ...(text ? [{ role: 'assistant', content: text }] : [])],
  });
  const failBeforeSpawn = () => {
    if (finished) return true;
    if (stopped) {
      finish({ kind: 'failed', error: 'Stopped.' });
      return true;
    }
    if (interrupted) {
      finish({ kind: 'interrupted', continuation: savedContinuation(true) });
      return true;
    }
    return false;
  };

  const handle = {
    settled,
    interrupt() {
      if (finished || stopped || interrupted) return;
      interrupted = true;
      if (!child) {
        if (req) failBeforeSpawn();
        return;
      }
      kill('SIGINT');
      graceTimer = timers.setTimeout(() => {
        if (finished) return;
        failure = 'Claude Code did not acknowledge interruption and exit. Queued messages were not applied.';
        uncertainEffects = true;
        terminate();
      }, INTERRUPT_GRACE_MS);
      graceTimer.unref?.();
    },
    stop() {
      if (finished || stopped) return;
      stopped = true;
      if (child) terminate();
      else if (req) failBeforeSpawn();
    },
  };

  const readLine = (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (!event || typeof event !== 'object') return;
    if (typeof event.session_id === 'string') {
      if (event.session_id === sessionId) sessionConfirmed = true;
      else sessionMismatch = true;
    }
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta'
      && event.event.delta?.type === 'text_delta' && typeof event.event.delta.text === 'string') {
      text += event.event.delta.text;
      if (!stopped && !failure) emit({ type: 'delta', text: event.event.delta.text });
    } else if (event.type === 'stream_event' && event.event?.type === 'content_block_start'
      && event.event.content_block?.type === 'text' && text && !/\n\s*$/.test(text)) {
      text += '\n\n';
      if (!stopped && !failure) emit({ type: 'delta', text: '\n\n' });
    } else if (event.type === 'assistant' || event.type === 'user') {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          pendingTools.add(block.id);
          toolBytes += Buffer.byteLength(JSON.stringify(block));
        } else if (block.type === 'tool_result') {
          pendingTools.delete(block.tool_use_id);
          toolBytes += Buffer.byteLength(JSON.stringify(block));
          if (block.is_error && unknownOutcome.test(JSON.stringify(block.content))) uncertainEffects = true;
        }
      }
      for (const activity of toolEvents(event, tools.labelTool)) {
        if (!stopped && !failure) emit(activity);
      }
    } else if (event.type === 'result') {
      result = event;
    }
    if (Buffer.byteLength(text) + toolBytes > MAX_TASK_OUTPUT_BYTES && !failure) {
      failure = 'Claude task output exceeded the 4 MB limit. Partial output was preserved.';
      terminate();
    }
  };

  void (async () => {
    try {
      const base = validateRequest(request);
      const cleanUpdates = updates.length ? validateMessages(updates) : [];
      if (cleanUpdates.some((message) => message.role !== 'user')) throw new Error('Queued messages must be from the user.');
      if (continuation) {
        if (continuation.provider !== 'claude' || continuation.version !== 1
          || continuation.model !== base.model || continuation.mode !== base.mode
          || continuation.conversationId !== base.conversationId
          || (!continuation.pending && (typeof continuation.sessionId !== 'string'
            || !/^[\w-]{1,100}$/.test(continuation.sessionId))) || !cleanUpdates.length) {
          throw new Error('Invalid Claude task continuation. Queued messages were not applied.');
        }
      }
      req = { ...base, messages: validateMessages([...(continuation?.messages ?? base.messages), ...cleanUpdates]) };
      if (failBeforeSpawn()) return;
      const bin = await findClaude();
      if (failBeforeSpawn()) return;
      if (!bin) throw new Error('Claude Code is not installed, so Jarvis cannot reach Claude.');
      const mcp = await tools.claudeMcpConfigFile().catch(() => null);
      if (failBeforeSpawn()) return;
      const resume = continuation && !continuation.pending
        ? { sessionId: continuation.sessionId, content: queuedContent(cleanUpdates) } : null;
      const built = buildArgs(req, mcp, resume);
      sessionId = built.sessionId;
      if (failBeforeSpawn()) return;
      child = spawn(bin, built.args, { cwd: workspace(), stdio: ['pipe', 'pipe', 'pipe'] });
      on(child.stderr, 'data', (data) => { stderr = (stderr + data).slice(-2000); });
      on(child.stdout, 'data', (data) => {
        buffer += data;
        if (Buffer.byteLength(buffer) > MAX_TASK_OUTPUT_BYTES) {
          failure = 'Claude task output exceeded the 4 MB limit. Partial output was preserved.';
          buffer = '';
          terminate();
          return;
        }
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) readLine(line);
        }
      });
      on(child.stdin, 'error', (error) => {
        failure = `Could not send files to Claude Code: ${error.message}`;
        terminate();
      });
      on(child, 'error', (error) => {
        failure = `Could not start Claude Code: ${error.message}`;
        // Node still emits close after a failed spawn; do not release ownership until then.
      });
      on(child, 'close', (code, signal) => {
        if (buffer.trim()) readLine(buffer.trim());
        if (stopped) return finish({ kind: 'failed', error: 'Stopped.', ...(pendingTools.size || uncertainEffects ? { uncertainEffects: true } : {}) });
        if (failure) return finish({ kind: 'failed', error: failure, ...(uncertainEffects || pendingTools.size ? { uncertainEffects: true } : {}) });
        if (pendingTools.size || uncertainEffects) {
          return finish({ kind: 'failed', error: 'A Claude tool outcome is unknown. Queued messages were not applied; check the action before retrying.', uncertainEffects: true });
        }
        if (sessionMismatch) return finish({ kind: 'failed', error: 'Claude returned an unexpected session. Queued messages were not applied.' });
        if (!text && result?.subtype === 'success' && typeof result.result === 'string' && result.result) {
          if (Buffer.byteLength(result.result) + toolBytes > MAX_TASK_OUTPUT_BYTES) {
            return finish({ kind: 'failed', error: 'Claude task output exceeded the 4 MB limit. Partial output was preserved.' });
          }
          text = result.result;
          if (emitResultText) emit({ type: 'delta', text });
        }
        if (interrupted) {
          const errors = Array.isArray(result?.errors) ? result.errors : [];
          const acknowledgement = result && (result.subtype === 'success'
            || /interrupt|cancelled by user/i.test([result.subtype, result.result, ...errors].join(' ')));
          if (!acknowledgement || !sessionConfirmed || (signal && signal !== 'SIGINT')
            || (code !== null && ![0, 1, 130].includes(code))) {
            return finish({ kind: 'failed', error: 'Claude Code did not provide a confirmed interruption session. Queued messages were not applied.', uncertainEffects: true });
          }
          return finish({ kind: 'interrupted', continuation: savedContinuation() });
        }
        if (!result || result.is_error || result.subtype !== 'success' || code !== 0) {
          const hint = /log ?in|auth/i.test(stderr) ? ' Sign in to Claude in Settings.' : '';
          return finish({ kind: 'failed', error: result?.result || `Claude Code exited before finishing (code ${code}).${hint}` });
        }
        recordSession(req, sessionId, text);
        finish({ kind: 'complete', continuation: savedContinuation() });
      });
      child.stdin.end(built.prompt);
    } catch (error) {
      if (child) {
        failure = error.message || 'Could not reach Claude Code.';
        terminate();
      } else {
        finish({ kind: 'failed', error: error.message || 'Could not reach Claude Code.' });
      }
    }
  })();
  return handle;
}

/** Existing stream IPC remains compatible; task callers use the explicit handle above. */
async function streamResponse(payload, emit, signal) {
  const handle = openAttempt({ request: payload, emitResultText: false }, emit);
  const abort = () => handle.stop();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const outcome = await handle.settled;
    emit(outcome.kind === 'complete' ? { type: 'done' } : { type: 'error', message: outcome.error || 'Stopped.' });
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function registerIpc(ipcMain) {
  const inflight = new Map();
  ipcMain.handle('claude:status', () => status());
  ipcMain.handle('claude:sign-in', () => signIn());
  ipcMain.handle('claude:sign-out', () => signOut());
  ipcMain.handle('claude:stream', (event, requestId, payload) => {
    if (typeof requestId !== 'string' || inflight.has(requestId)) return;
    const controller = new AbortController();
    inflight.set(requestId, controller);
    const sender = event.sender;
    const emit = (msg) => {
      if (!sender.isDestroyed()) sender.send('claude:stream-event', requestId, msg);
    };
    streamResponse(payload, emit, controller.signal).finally(() => inflight.delete(requestId));
  });
  ipcMain.handle('claude:abort', (_event, requestId) => inflight.get(requestId)?.abort());
}

module.exports = { registerIpc, validateRequest, buildArgs, recordSession, transcriptPrompt, toolEvents, openAttempt, CHAT_SYSTEM_PROMPT };
