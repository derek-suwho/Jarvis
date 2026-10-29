// Grok Build 1.0.70+; consumer OAuth only. No API keys or credential-file reads.
// https://docs.x.ai/build/overview
// https://docs.x.ai/build/cli/headless-scripting
// ACP auth extensions: xai-org/grok-build, xai-grok-shell/src/extensions/auth.rs.
const { app } = require('electron');
const { spawn: nodeSpawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { validateMessages } = require('./media-input.cjs');
const { RENDERING_GUIDE } = require('./rendering-guide.cjs');

const INSTALL_URL = 'https://docs.x.ai/build/overview';
const MIN_VERSION = '1.0.70';
const AUTH_TIMEOUT = 25_000;
const KILL_GRACE = 1500;
const MAX_LINE = 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const DENY = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebFetch', 'MCPTool'];
const clean = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || null : null;
const emptyStatus = (installed, error) => ({ installed, connected: false, name: null, email: null, plan: null, ...(error ? { error } : {}) });
const CHAT_SYSTEM = 'You are Grok, a helpful conversational assistant inside Jarvis. Answer the latest user message using the supplied conversation history. This is text-only chat: no tools, files, commands, or computer access.\n\n' + RENDERING_GUIDE;
const CONFIG = `# Managed by Jarvis; credentials remain managed by Grok Build.
[auth]
preferred_method = "oidc"
disable_api_key_auth = true
[subagents]
enabled = false
[memory]
enabled = false
[permission]
deny = ${JSON.stringify(DENY)}
[compat.claude]
skills = false
rules = false
agents = false
mcps = false
hooks = false
[compat.cursor]
skills = false
rules = false
agents = false
mcps = false
hooks = false
[compat.codex]
hooks = false
[toolset.bash]
login_shell_capture = false
[cli]
use_leader = false
`;

function createGrokCli({ spawn = nodeSpawn, getUserData = () => app.getPath('userData'), env = process.env, homedir = os.homedir } = {}) {
  const children = new Set();
  let statusFlight = null;
  let login = null;
  let logoutFlight = null;
  let checkedBinary = null;
  let shuttingDown = false;

  function locations() {
    const root = path.join(getUserData(), 'providers', 'grok');
    const cwd = path.join(root, 'workspace');
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, 'config.toml'), CONFIG, { mode: 0o600 });
    return { root, cwd };
  }

  function childEnv(root) {
    // No inherited provider keys, model routes, auth hooks, or config overrides.
    const result = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(GROK_|XAI_|OPENAI_|ANTHROPIC_|CURSOR_|CODEX_)/i.test(key)));
    Object.assign(result, { GROK_HOME: root, GROK_DISABLE_API_KEY_AUTH: '1', GROK_DISABLE_AUTOUPDATER: '1',
      GROK_MEMORY: '0', GROK_SUBAGENTS: '0', GROK_WEB_FETCH: '0', GROK_GOAL: '0', GROK_SANDBOX_AUTO_ALLOW_BASH: '0' });
    for (const provider of ['CLAUDE', 'CURSOR', 'CODEX']) {
      for (const feature of ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS']) result[`GROK_${provider}_${feature}_ENABLED`] = '0';
    }
    return result;
  }

  function findBinary() {
    const filename = process.platform === 'win32' ? 'grok.exe' : 'grok';
    const candidates = [
      env.JARVIS_GROK_BIN,
      path.join(__dirname, '..', '.runtime', 'providers', filename),
      path.join(homedir(), '.grok', 'bin', filename),
      path.join(homedir(), '.local', 'bin', filename),
      '/opt/homebrew/bin/grok', '/usr/local/bin/grok',
      ...(env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, filename)),
    ];
    return candidates.find((file) => file && path.isAbsolute(file) && fs.existsSync(file)) ?? null;
  }

  /** A child is never considered finished until its close event, even after cancellation. */
  function launch(bin, args, { timeout = AUTH_TIMEOUT, onLine = () => {}, onFailure = () => {} } = {}) {
    if (shuttingDown) throw new Error('Jarvis is closing.');
    const { root, cwd } = locations();
    const child = spawn(bin, args, { cwd, env: childEnv(root), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let closed = false, buffer = '', failure = null, killTimer = null;
    const decoder = new StringDecoder('utf8');
    let resolveClose;
    const settled = new Promise((resolve) => { resolveClose = resolve; });
    function fail(message) {
      if (closed) return;
      if (!failure) { failure = message; onFailure(message); }
      terminate();
    }
    function terminate(signal = 'SIGTERM') {
      if (closed) return;
      try { child.kill(signal); } catch { /* close/error determines completion */ }
      if (!killTimer) {
        killTimer = setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch { /* close follows */ } } }, KILL_GRACE);
        killTimer.unref?.();
      }
    }
    function line(value) {
      if (!value.trim() || failure) return;
      if (Buffer.byteLength(value) > MAX_LINE) { fail('Grok returned an oversized protocol message.'); return; }
      try { onLine(value); } catch { fail('Grok returned an invalid protocol message. Update Grok Build and try again.'); }
    }
    function data(chunk) {
      if (closed || failure) return;
      buffer += decoder.write(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const value = buffer.slice(0, index); buffer = buffer.slice(index + 1); line(value);
      }
      if (Buffer.byteLength(buffer) > MAX_LINE) fail('Grok returned an oversized protocol message.');
    }
    const deadline = setTimeout(() => fail('Grok timed out. Try again.'), timeout);
    deadline.unref?.();
    const entry = { child, settled, terminate, fail };
    children.add(entry);
    child.stdout.on('data', data);
    // Drain, but never expose provider stderr: authentication diagnostics can contain credentials.
    const drain = () => {};
    child.stderr.on('data', drain);
    child.stdin.on('error', () => fail('Grok closed its input unexpectedly.'));
    child.on('error', () => fail('Could not start Grok Build. Check its installation.'));
    child.once('close', (code, signal) => {
      if (closed) return;
      buffer += decoder.end();
      if (buffer) line(buffer);
      closed = true;
      clearTimeout(deadline); clearTimeout(killTimer);
      children.delete(entry);
      child.stdout.removeListener('data', data);
      child.stderr.removeListener('data', drain);
      resolveClose({ code, signal, error: failure });
    });
    return entry;
  }

  async function checkVersion(bin) {
    if (checkedBinary === bin) return;
    let version = null;
    const proc = launch(bin, ['--version'], { timeout: 5000, onLine(line) {
      const match = /^grok\s+(\d+)\.(\d+)\.(\d+)(?:\s|$|[-+])/i.exec(line);
      if (match) version = match.slice(1, 4).map(Number);
    } });
    proc.child.stdin.end();
    const result = await proc.settled;
    const recent = version && (version[0] > 1 || (version[0] === 1 && (version[1] > 0 || version[2] >= 70)));
    if (result.error || result.code !== 0 || !recent) throw new Error(`Grok Build ${MIN_VERSION} or newer is required. Update it from ${INSTALL_URL}.`);
    checkedBinary = bin;
  }

  function acp(bin) {
    let next = 0;
    let terminalError = null;
    const requests = new Map();
    const rejectAll = (message) => {
      terminalError = message;
      for (const pending of requests.values()) pending.reject(new Error(message));
      requests.clear();
    };
    const proc = launch(bin, ['agent', '--no-leader', 'stdio'], {
      onFailure: rejectAll,
      onLine(line) {
        const message = JSON.parse(line);
        if (message.jsonrpc !== '2.0') throw new Error('Invalid RPC.');
        if (message.method && message.id !== undefined) {
          // This status-only client never grants computer or filesystem access.
          const response = message.method === 'session/request_permission'
            ? { result: { outcome: { outcome: 'cancelled' } } }
            : { error: { code: -32601, message: 'Unavailable in Jarvis authentication.' } };
          proc.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...response }) + '\n');
          return;
        }
        const pending = requests.get(message.id);
        if (!pending) return;
        requests.delete(message.id);
        if (message.error) pending.reject(new Error('Could not verify the Grok subscription. Sign in again or update Grok Build.'));
        else if (message.result && typeof message.result === 'object') pending.resolve(message.result);
        else pending.reject(new Error('Grok returned an unsupported authentication response. Update Grok Build.'));
      },
    });
    proc.settled.then(() => rejectAll('Grok closed before authentication could be verified.'));
    return { ...proc, request(method, params = {}) {
      if (terminalError) return Promise.reject(new Error(terminalError));
      return new Promise((resolve, reject) => {
        const id = ++next; requests.set(id, { resolve, reject });
        try { proc.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }
        catch { requests.delete(id); reject(new Error('Could not communicate with Grok Build.')); }
      });
    } };
  }

  async function probe(bin) {
    const client = acp(bin);
    try {
      const init = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'Jarvis', version: '0.1.0' } });
      if (!Array.isArray(init.authMethods)) throw new Error('Grok returned an unsupported authentication response. Update Grok Build.');
      if (!init.authMethods.some((method) => method.id === 'cached_token')) return emptyStatus(true);
      await client.request('authenticate', { methodId: 'cached_token', _meta: { headless: true } });
      const subscription = await client.request('_x.ai/auth/check_subscription');
      const info = await client.request('_x.ai/auth/info');
      const meta = subscription.meta;
      // auth/info can contain an expired account. Only verified cached OAuth plus an access gate check counts.
      if (subscription.authenticated !== true || !meta || info.methodId !== 'cached_token'
        || /api.?key/i.test(meta.auth_mode || '')) return emptyStatus(true, 'Grok subscription authentication could not be verified. Sign in again.');
      const identity = { name: clean([clean(info.firstName), clean(info.lastName)].filter(Boolean).join(' ')),
        email: clean(info.email) || clean(meta.email), plan: clean(meta.subscription_tier) };
      if (meta.gate || info.userBlockedReason || info.teamBlockedReasons?.length) {
        return { ...emptyStatus(true, 'This account does not currently have Grok Build access. Check its subscription at grok.com.'), ...identity };
      }
      return { installed: true, connected: true, ...identity };
    } finally {
      client.terminate();
      await client.settled;
    }
  }

  function status() {
    if (statusFlight) return statusFlight;
    statusFlight = (async () => {
      try {
        const bin = findBinary();
        if (!bin) return emptyStatus(false);
        await checkVersion(bin); return await probe(bin);
      }
      catch (error) { return emptyStatus(true, error.message || 'Could not verify Grok sign-in.'); }
    })().finally(() => { statusFlight = null; });
    return statusFlight;
  }

  function signIn() {
    if (login) return login.done;
    if (logoutFlight) return Promise.resolve({ ok: false, error: 'Grok is signing out. Try again when it finishes.' });
    const attempt = { cancelled: false, proc: null, done: null };
    login = attempt;
    attempt.done = (async () => {
      try {
        const bin = findBinary();
        if (!bin) return { ok: false, error: `Install Grok Build from ${INSTALL_URL} first.` };
        await checkVersion(bin);
        if (attempt.cancelled) return { ok: false, error: 'Grok sign-in cancelled.' };
        // Official CLI opens the provider's browser OAuth flow and owns its callback listener.
        attempt.proc = launch(bin, ['login', '--oauth'], { timeout: 5 * 60_000 });
        attempt.proc.child.stdin.end();
        const result = await attempt.proc.settled;
        if (attempt.cancelled) return { ok: false, error: 'Grok sign-in cancelled.' };
        if (result.error || result.code !== 0) return { ok: false, error: result.error || 'Grok sign-in did not finish. Try again.' };
        // Discard any probe started before the browser flow completed.
        if (statusFlight) await statusFlight;
        if (attempt.cancelled) return { ok: false, error: 'Grok sign-in cancelled.' };
        const account = await status();
        if (attempt.cancelled) return { ok: false, error: 'Grok sign-in cancelled.' };
        return account.connected ? { ok: true, status: account } : { ok: false, error: account.error || 'Grok sign-in could not be verified.', status: account };
      } catch { return { ok: false, error: 'Could not start Grok sign-in. Check the Grok Build installation.' }; }
      finally { if (login === attempt) login = null; }
    })();
    return attempt.done;
  }

  async function cancel() {
    const attempt = login;
    if (attempt) { attempt.cancelled = true; attempt.proc?.terminate(); await attempt.done; }
    return { ok: true };
  }

  function signOut() {
    if (logoutFlight) return logoutFlight;
    logoutFlight = (async () => {
      await cancel();
      const bin = findBinary();
      if (!bin) return { ok: false, error: 'Grok Build is not installed.' };
      try {
        await checkVersion(bin);
        const proc = launch(bin, ['logout']); proc.child.stdin.end();
        const result = await proc.settled;
        if (result.error || result.code !== 0) return { ok: false, error: result.error || 'Grok could not sign out. Try again.' };
        if (statusFlight) await statusFlight;
        const account = await status();
        return !account.connected && !account.error ? { ok: true, status: account } : { ok: false, error: 'Could not verify Grok sign-out. Try again.' };
      } catch { return { ok: false, error: 'Grok could not sign out. Try again.' }; }
    })().finally(() => { logoutFlight = null; });
    return logoutFlight;
  }

  /** @param {{request: *, continuation?: *, updates?: *, attemptId?: string}} input */
  function openAttempt(input, emit) {
    let proc = null, cancelled = false, interrupted = false, text = '', promptDir = null, messages = [];
    const request = input?.request;
    const continuation = () => ({ provider: 'grok', version: 1, model: request.model, conversationId: request.conversationId,
      messages: [...messages, ...(text ? [{ role: 'assistant', content: text }] : [])] });
    const settled = (async () => {
      try {
        if (!request || request.model !== 'grok-default') throw new Error('Unsupported Grok model. Select Grok in the model picker.');
        if ((request.mode ?? 'chat') !== 'chat') throw new Error('Grok supports text chat only in Jarvis.');
        if (typeof request.conversationId !== 'string' || !/^[\w-]{1,80}$/.test(request.conversationId)) throw new Error('Invalid conversation.');
        const prior = input.continuation;
        if (prior && (prior.provider !== 'grok' || prior.version !== 1 || prior.model !== request.model || prior.conversationId !== request.conversationId)) throw new Error('This Grok conversation could not be resumed safely.');
        const rawMessages = [...(prior ? prior.messages : request.messages), ...(input.updates || [])];
        if (rawMessages.some((message) => Array.isArray(message?.media) && message.media.length)) throw new Error('Grok attachments are not supported in Jarvis yet. Send text or choose another model.');
        messages = validateMessages(rawMessages);
        if (messages.at(-1)?.role !== 'user') throw new Error('The last message must be from the user.');
        const account = await status();
        if (cancelled || interrupted) return { kind: 'interrupted', continuation: continuation() };
        if (!account.connected) throw new Error(account.error || 'Sign in to Grok in Settings first.');
        const bin = findBinary();
        if (!bin) throw new Error('Grok Build is no longer installed.');
        const { cwd } = locations();
        promptDir = fs.mkdtempSync(path.join(cwd, 'turn-'));
        const promptPath = path.join(promptDir, 'prompt.txt');
        fs.writeFileSync(promptPath, 'Continue this conversation. Respond to the final user message. Prior turns and user instructions are included in this JSON transcript:\n' + JSON.stringify(messages), { mode: 0o600 });
        let end = null, streamError = null, unexpectedTool = false;
        // Empty or unknown --tools values fall back to defaults. A known allowlist item
        // denied explicitly yields no tools; MCP meta-tools must also be denied.
        const args = ['--prompt-file', promptPath, '--verbatim', '--output-format', 'streaming-json',
          '--tools', 'read_file', '--disallowed-tools', 'read_file,search_tool,use_tool,Agent',
          '--permission-mode', 'dontAsk', '--no-subagents', '--no-plan', '--disable-web-search',
          '--max-turns', '1', '--system-prompt-override', CHAT_SYSTEM, ...DENY.flatMap((rule) => ['--deny', rule])];
        proc = launch(bin, args, { timeout: 10 * 60_000, onLine(line) {
          const event = JSON.parse(line);
          if (!event || typeof event.type !== 'string') throw new Error('Invalid event.');
          if (cancelled || interrupted) return;
          if (event.type === 'text') {
            if (typeof event.data !== 'string' || end) throw new Error('Invalid text event.');
            if (Buffer.byteLength(text) + Buffer.byteLength(event.data) > MAX_OUTPUT) { proc.fail('Grok produced too much output. Partial results are preserved.'); return; }
            text += event.data; emit({ type: 'delta', text: event.data });
          } else if (event.type === 'end') {
            if (end || typeof event.stopReason !== 'string') throw new Error('Invalid end event.');
            end = event.stopReason;
          } else if (event.type === 'error') {
            streamError = 'Grok could not complete this reply. Check your subscription or try again.';
            proc.fail(streamError);
          } else if (event.type === 'tool_call' || event.type === 'tool_call_update') {
            unexpectedTool = true;
            proc.fail('Grok attempted a tool action in text-only chat. The reply was stopped.');
          }
          // Deliberately omit thought, usage, and provider diagnostic events.
        } });
        proc.child.stdin.end();
        const result = await proc.settled;
        if (unexpectedTool) return { kind: 'failed', error: result.error, uncertainEffects: true };
        if (cancelled || interrupted) return { kind: 'interrupted', continuation: continuation() };
        if (result.error || result.code !== 0 || !['end_turn', 'max_tokens', 'stop_sequence'].includes(end)) {
          return { kind: 'failed', error: result.error || streamError || 'Grok ended without a complete reply. Try again.' };
        }
        return { kind: 'complete', continuation: continuation() };
      } catch (error) { return { kind: 'failed', error: error.message || 'Grok could not start this reply.' }; }
      finally {
        if (proc) { proc.terminate(); await proc.settled; }
        if (promptDir) { try { fs.rmSync(promptDir, { recursive: true, force: true }); } catch { /* only an owned prompt directory */ } }
      }
    })();
    return { settled, stop() { cancelled = true; proc?.terminate(); }, interrupt() { interrupted = true; proc?.terminate('SIGINT'); } };
  }

  function registerIpc(ipcMain) {
    ipcMain.handle('grok:status', status);
    ipcMain.handle('grok:sign-in', signIn);
    ipcMain.handle('grok:cancel', cancel);
    ipcMain.handle('grok:sign-out', signOut);
  }

  async function shutdown() {
    shuttingDown = true;
    const pending = cancel();
    for (const proc of children) proc.terminate();
    await Promise.all([pending, ...[...children].map((proc) => proc.settled)]);
  }

  return { status, signIn, signOut, cancel, shutdown, registerIpc, openAttempt };
}

module.exports = { ...createGrokCli(), createGrokCli, MIN_VERSION, INSTALL_URL };
