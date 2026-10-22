// Claude via the user's own, unmodified Claude Code CLI. Sign-in happens only in Claude Code's own flow
// (`claude auth login`); Jarvis never reads or stores Claude credentials.
// Terms: https://code.claude.com/docs/en/legal-and-compliance
const { app } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('./tools/index.cjs');

const CHAT_SYSTEM_PROMPT = [
  'You are Claude, chatting with the user inside Jarvis, a desktop chat app.',
  'Be a helpful, thoughtful general-purpose assistant: answer directly, use Markdown when it helps',
  '(headings, lists, tables, fenced code), and match the depth of your answer to the question.',
  'You have no access to the user\'s files or computer in this mode, apart from any tools you are given.',
].join(' ');

const EFFORT = { None: 'low', Low: 'low', Medium: 'medium', High: 'high', 'Extra High': 'xhigh', Max: 'max' };
const MAX_MESSAGES = 200;
const MAX_CHARS = 400_000;

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
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error('Invalid conversation.');
  }
  let total = 0;
  const clean = messages.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new Error('Invalid message.');
    }
    total += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (total > MAX_CHARS) throw new Error('Conversation is too long to send.');
  if (clean[clean.length - 1].role !== 'user') throw new Error('The last message must be from the user.');
  return { model, mode, effort: EFFORT[reasoning] ?? null, conversationId, messages: clean };
}

const digest = (messages) => crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');

/** Prior turns as a transcript, for when Jarvis's history no longer matches a Claude Code session. */
function transcriptPrompt(messages) {
  const prior = messages.slice(0, -1);
  const latest = messages[messages.length - 1].content;
  if (prior.length === 0) return latest;
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
function buildArgs(req, mcp = null) {
  const prior = req.messages.slice(0, -1);
  const cached = sessions.get(req.conversationId);
  const resume =
    cached && cached.mode === req.mode && cached.model === req.model && cached.digest === digest(prior) ? cached : null;
  const sessionId = resume ? resume.sessionId : crypto.randomUUID();
  const prompt = resume ? req.messages[req.messages.length - 1].content : transcriptPrompt(req.messages);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', req.model];
  args.push(...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]));
  if (req.effort) args.push('--effort', req.effort);
  if (req.mode === 'chat') {
    // Plain chat: Jarvis's system prompt, no built-in tools, and none of the user's hooks or CLAUDE.md.
    args.push('--system-prompt', CHAT_SYSTEM_PROMPT, '--tools', '', '--setting-sources', '');
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

async function streamResponse(payload, emit, signal) {
  let req;
  try {
    req = validateRequest(payload);
  } catch (err) {
    emit({ type: 'error', message: err.message });
    return;
  }
  const bin = await findClaude();
  if (!bin) {
    emit({ type: 'error', message: 'Claude Code is not installed, so Jarvis cannot reach Claude.' });
    return;
  }
  const mcp = await tools.claudeMcpConfigFile().catch(() => null);
  const { args, prompt, sessionId } = buildArgs(req, mcp);
  const child = spawn(bin, args, { cwd: workspace(), stdio: ['pipe', 'pipe', 'pipe'] });
  signal?.addEventListener('abort', () => child.kill('SIGTERM'));
  child.stdin.end(prompt);

  let text = '';
  let finished = false;
  let stderr = '';
  let buffer = '';
  const finish = (msg) => {
    if (finished) return;
    finished = true;
    emit(msg);
  };

  child.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.type === 'text_delta') {
        text += e.event.delta.text;
        emit({ type: 'delta', text: e.event.delta.text });
      } else if (e.type === 'stream_event' && e.event?.type === 'content_block_start' && e.event.content_block?.type === 'text') {
        // Text after a tool call starts a new paragraph instead of running on from the last one.
        if (text && !/\n\s*$/.test(text)) {
          text += '\n\n';
          emit({ type: 'delta', text: '\n\n' });
        }
      } else if (e.type === 'assistant' || e.type === 'user') {
        for (const event of toolEvents(e, tools.labelTool)) emit(event);
      } else if (e.type === 'result') {
        if (e.is_error || e.subtype !== 'success') {
          sessions.delete(req.conversationId);
          finish({ type: 'error', message: e.result || `Claude stopped (${e.subtype}).` });
        } else {
          recordSession(req, sessionId, text || e.result || '');
          finish({ type: 'done' });
        }
      }
    }
  });
  // Resolve only when the process exits, so the request stays abortable until then.
  await new Promise((resolve) => {
    child.on('error', (err) => {
      finish({ type: 'error', message: `Could not start Claude Code: ${err.message}` });
      resolve();
    });
    child.on('close', (code) => {
      if (signal?.aborted) finish({ type: 'error', message: 'Stopped.' });
      const hint = /log ?in|auth/i.test(stderr) ? ' Sign in to Claude in Settings.' : '';
      finish({ type: 'error', message: `Claude Code exited before finishing (code ${code}).${hint}` });
      resolve();
    });
  });
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

module.exports = { registerIpc, validateRequest, buildArgs, recordSession, transcriptPrompt, toolEvents, CHAT_SYSTEM_PROMPT };
