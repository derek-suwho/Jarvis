// Google-account Gemini access through the unmodified Antigravity CLI (agy).
// Verified against agy 1.4.9 and Google's CLI/auth/headless/custom-agent docs:
// https://antigravity.google/docs/install/
// https://antigravity.google/docs/cli/headless/
// https://antigravity.google/docs/subagents/
// Credentials stay in the CLI's keyring. Jarvis never creates an API-key session.
const { app, shell } = require('electron');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { validateMessages } = require('./media-input.cjs');
const { RENDERING_GUIDE } = require('./rendering-guide.cjs');

const AGENT_NAME = 'jarvis-chat';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_COMMAND_BYTES = 256 * 1024;
const STATUS_TTL_MS = 2000;
const KILL_GRACE_MS = 2000;
const EFFORT = { None: 'low', Low: 'low', Medium: 'medium', High: 'high', 'Extra High': 'xhigh', Max: 'max' };
const AUTH_REQUIRED = /authentication required|not (?:logged|signed) in|authentication (?:failed|timed out)|sign in to continue/i;
const ACCOUNT_ONLY_ERROR = 'Gemini requires Google account sign-in. Switch Antigravity CLI from API-key or Google Cloud billing to a personal Google account first.';
const AGENT_PROFILE = `---
name: ${AGENT_NAME}
description: General conversation in Jarvis, without access to files, commands, browsers, or other tools.
mainAgent: true
subagent: false
model: inherit
tools: []
mcpServers: []
skills: []
plugins: []
commandExecutionPolicy: off
---
You are Gemini, a helpful conversational assistant inside Jarvis.
Answer the user's question directly. You have no tools in this chat.
Do not claim to read files, browse websites, execute commands, or change the user's computer.
Conversation history is supplied as a JSON transcript. Answer its latest user message.

${RENDERING_GUIDE}
`;

const emptyStatus = (installed, error) => ({
  installed, connected: false, name: null, email: null, plan: null,
  ...(error ? { error } : {}),
});

function accountEnvironment(environment) {
  const clean = { ...environment, NO_COLOR: '1', TERM: 'dumb' };
  for (const name of [
    'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_QUOTA_PROJECT',
    'GOOGLE_CLOUD_LOCATION', 'AGY_ADC_AUTH', 'GOOGLE_GEMINI_BASE_URL',
  ]) delete clean[name];
  return clean;
}

function cleanText(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

/** A successful /usage report is a server-backed quota check, not a local token-file guess. */
function parseUsage(stdout) {
  const output = cleanText(stdout);
  // An explicit login can print its OAuth prelude before the final quota report.
  // Only that final report establishes success; later errors invalidate it.
  // The only published report shape is Google's /usage screenshot:
  // https://antigravity.google/assets/image/docs/cli/usage-tui.png
  // Fail closed if the CLI's standalone report differs from that shape.
  const headings = [...output.matchAll(/^[\s└╰│]*Models\s*&\s*Quota\s*$/gim)];
  const start = headings.at(-1)?.index;
  if (start === undefined) return null;
  const text = output.slice(start);
  if (AUTH_REQUIRED.test(text) || /\b(?:error|failed|timed out)\b/i.test(text)
    || !/^\s*GEMINI MODELS\s*$/im.test(text) || !/\b\d+(?:\.\d+)?%\s+remaining\b/i.test(text)) return null;
  const field = (name) => text.match(new RegExp(`^\\s*${name}\\s*:\\s*([^\\n]+)`, 'im'))?.[1]?.trim() ?? null;
  const email = field('Account');
  return {
    installed: true, connected: true,
    name: null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    plan: null,
  };
}

function parseModels(stdout) {
  return [...cleanText(stdout).matchAll(/^\s*(gemini-[a-z0-9][a-z0-9.-]{0,95})\s+([^\n]+)$/gim)]
    .map((match) => ({ id: match[1], name: match[2].trim() }));
}

function validateRequest(payload) {
  const { model, messages, conversationId, reasoning, mode = 'chat' } = payload ?? {};
  if (typeof model !== 'string' || (model !== 'gemini-default' && !/^gemini-[a-z0-9][a-z0-9.-]{0,95}$/i.test(model))) {
    throw new Error('Choose a Gemini model.');
  }
  if (mode !== 'chat') throw new Error('Gemini currently supports chat mode in Jarvis.');
  if (typeof conversationId !== 'string' || !/^[\w-]{1,80}$/.test(conversationId)) throw new Error('Invalid conversation.');
  const clean = validateMessages(messages);
  if (clean.at(-1).role !== 'user') throw new Error('The last message must be from the user.');
  if (clean.some((message) => message.media?.length)) {
    throw new Error('Antigravity CLI accepts text only. Remove image/PDF attachments or choose another provider.');
  }
  return { model, messages: clean, conversationId, mode, effort: EFFORT[reasoning] ?? null };
}

function buildArgs(request, model) {
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json',
    '--disable-slash-commands', '--agent', AGENT_NAME, '--model', model, '--print-timeout', '5m'];
  if (request.effort) args.push('--effort', request.effort);
  return args;
}

function promptFor(messages) {
  return JSON.stringify({ event: 'user', message: {
    content: `Conversation transcript:\n${JSON.stringify(messages)}\n\nRespond to the latest user message.`,
  } }) + '\n';
}

function createAdapter(dependencies = {}) {
  const spawn = dependencies.spawn ?? childProcess.spawn;
  const files = dependencies.fs ?? fs;
  const environment = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const home = dependencies.home ?? os.homedir();
  const userData = dependencies.userData ?? (() => app.getPath('userData'));
  const openExternal = dependencies.openExternal ?? ((url) => shell.openExternal(url));
  const signalProcess = dependencies.kill ?? ((pid, signal) => process.kill(pid, signal));
  const activeCommands = new Set();
  const activeAttempts = new Set();
  let login = null;
  let loginPromise = null;
  let logoutPromise = null;
  let loginGeneration = 0;
  let statusPromise = null;
  let cachedStatus = null;
  let cachedAt = 0;
  let shuttingDown = false;

  function findCli() {
    const executable = platform === 'win32' ? 'agy.exe' : 'agy';
    const candidates = [
      environment.JARVIS_GEMINI_CLI,
      path.join(__dirname, '..', '.runtime', 'providers', executable),
      path.join(home, '.local', 'bin', executable),
      '/opt/homebrew/bin/agy', '/usr/local/bin/agy',
      ...(environment.PATH ?? '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executable)),
    ];
    return candidates.find((candidate) => {
      if (!candidate || !path.isAbsolute(candidate)) return false;
      try { files.accessSync(candidate, fs.constants.X_OK); return files.statSync(candidate).isFile(); }
      catch { return false; }
    }) ?? null;
  }

  function assertAccountMode() {
    for (const [file, inspect] of [
      [path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), (settings) => settings.modelProvider || Object.keys(settings.gcp ?? {}).length],
      [path.join(home, '.gemini', 'config', 'config.json'), (settings) => settings.userSettings?.enableAdc === true],
    ]) {
      let content;
      try { content = files.readFileSync(file, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Could not read Antigravity account settings.'); }
      let settings;
      try { settings = JSON.parse(content); }
      catch { throw new Error('Fix the invalid Antigravity settings file before connecting Gemini.'); }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid Antigravity account settings.');
      if (inspect(settings)) throw new Error(ACCOUNT_ONLY_ERROR);
    }
  }

  function assertIsolatedCustomizations() {
    // Text rules and MCP metadata may load normally; init must still confirm no
    // callable tools. Session hooks execute outside that tool boundary, so reject
    // enabled command hooks before any CLI process starts.
    const hookFiles = [path.join(home, '.gemini', 'config', 'hooks.json')];
    const pluginDirectories = [
      path.join(home, '.gemini', 'config', 'plugins'),
      path.join(home, '.gemini', 'antigravity-cli', 'plugins'),
    ];
    for (const directory of pluginDirectories) {
      try {
        for (const name of files.readdirSync(directory)) hookFiles.push(path.join(directory, name, 'hooks.json'));
      } catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not inspect Antigravity plugin hooks.'); }
    }
    const activeHooks = hookFiles.some((file) => {
      try {
        const content = files.readFileSync(file, 'utf8').trim();
        if (!content) return false;
        const config = JSON.parse(content);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid hooks');
        return Object.values(config).some((definition) => definition && typeof definition === 'object'
          && definition.enabled !== false
          && ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop']
            .some((event) => Array.isArray(definition[event]) && definition[event].length > 0));
      }
      catch (error) { if (error.code === 'ENOENT') return false; throw new Error('Could not inspect Antigravity executable customizations.'); }
    });
    if (activeHooks) throw new Error('Enabled Antigravity command hooks can run outside the chat tool boundary. Disable those hooks in Antigravity before connecting Gemini in Jarvis.');
  }

  function workspace(attempt = false) {
    const directory = path.join(userData(), 'gemini-workspace', attempt ? randomUUID() : 'account');
    const agents = path.join(directory, '.agents', 'agents');
    files.mkdirSync(agents, { recursive: true, mode: 0o700 });
    files.writeFileSync(path.join(agents, `${AGENT_NAME}.md`), AGENT_PROFILE, { mode: 0o600 });
    return directory;
  }

  function signalChild(child, signal) {
    try {
      // Each CLI has its own process group, including its language-server child.
      if (platform !== 'win32' && Number.isInteger(child.pid) && child.pid > 0) signalProcess(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        try { child.kill(signal); } catch { /* close/error remains the completion boundary */ }
      }
    }
  }

  function command(binary, args, options = {}) {
    let child;
    let closed = false;
    let cancelled = false;
    let timedOut = false;
    let authRequired = false;
    let opened = false;
    let failure = null;
    let stdout = '';
    let stderr = '';
    let killTimer;
    let timer;
    let resolveResult;
    const decoder = new StringDecoder('utf8');
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const controller = {
      result,
      cancel() { cancelled = true; terminate(); },
    };
    activeCommands.add(controller);
    const finish = (code, signal) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      activeCommands.delete(controller);
      resolveResult({ code, signal, stdout, stderr, authRequired, cancelled, timedOut, failure });
    };
    function terminate() {
      if (!child || closed) return;
      signalChild(child, 'SIGTERM');
      if (!killTimer) {
        killTimer = setTimeout(() => { if (!closed) signalChild(child, 'SIGKILL'); }, KILL_GRACE_MS);
        killTimer.unref?.();
      }
    }
    const inspect = () => {
      const output = stdout + '\n' + stderr;
      if (Buffer.byteLength(output) > MAX_COMMAND_BYTES) { failure = 'Antigravity CLI returned too much output.'; terminate(); return; }
      if (AUTH_REQUIRED.test(output)) {
        authRequired = true;
        if (!options.allowLogin) { terminate(); return; }
      }
      if (!options.allowLogin || opened || cancelled || failure) return;
      const raw = [stdout, stderr].map((stream) => stream.match(/https:\/\/accounts\.google\.com\/[^\s\x1b]+(?=\s)/)?.[0]).find(Boolean);
      if (!raw) return;
      let url;
      try { url = new URL(raw); } catch { return; }
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password
        || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)) return;
      // Do not open a URL while a chunk containing the query is still incomplete.
      if (!url.searchParams.has('state') || !url.searchParams.has('code_challenge')
        || url.searchParams.get('redirect_uri') !== 'https://antigravity.google/oauth-callback'
        || url.searchParams.get('response_type') !== 'code'
        || url.searchParams.get('code_challenge_method') !== 'S256') return;
      opened = true;
      Promise.resolve().then(() => openExternal(url.href)).catch(() => {
        failure = 'Could not open Google sign-in. Check your default browser and try again.';
        terminate();
      });
    };
    try {
      assertAccountMode();
      assertIsolatedCustomizations();
      const commandArgs = args[0] === '--print' ? [...args, '--agent', AGENT_NAME] : args;
      child = spawn(binary, commandArgs, { cwd: workspace(), env: accountEnvironment(environment),
        detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.on('data', (data) => { if (!failure) { stdout += decoder.write(data); inspect(); } });
      child.stderr.on('data', (data) => { if (!failure) { stderr += data.toString('utf8'); inspect(); } });
      child.stdin.on('error', () => { failure = 'Could not communicate with Antigravity CLI.'; terminate(); });
      child.on('error', () => { failure = 'Could not start Antigravity CLI.'; });
      child.on('close', (code, signal) => { stdout += decoder.end(); finish(code, signal); });
      timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeout ?? 15000);
      timer.unref?.();
      if (options.allowLogin) options.onController?.(controller);
      // Keep stdin open for the CLI-owned Google OAuth flow; no credentials are supplied by Jarvis.
      else child.stdin.end();
    } catch {
      failure = 'Could not start Antigravity CLI.';
      if (child) terminate();
      else finish(null, null);
    }
    return controller;
  }

  const remember = (value) => { cachedStatus = value; cachedAt = Date.now(); return value; };
  const invalidate = () => { cachedStatus = null; cachedAt = 0; };
  async function probeAccount(binary) {
    try { assertAccountMode(); assertIsolatedCustomizations(); } catch (error) { return remember(emptyStatus(true, error.message)); }
    const check = await command(binary, ['--print', '/usage', '--print-timeout', '10s']).result;
    if (check.authRequired) return remember(emptyStatus(true));
    if (check.code === 0 && !check.failure && !check.timedOut && !check.cancelled) {
      const account = parseUsage(check.stdout);
      if (account) return remember(account);
    }
    return remember(emptyStatus(true, check.timedOut ? 'Antigravity account check timed out. Try again.' : 'Could not verify your Google account with Antigravity CLI.'));
  }

  async function status() {
    if (shuttingDown) return emptyStatus(!!findCli());
    if (logoutPromise) return emptyStatus(!!findCli());
    if (loginPromise) return cachedStatus ?? emptyStatus(!!findCli());
    if (cachedStatus && Date.now() - cachedAt < STATUS_TTL_MS) return cachedStatus;
    if (statusPromise) return statusPromise;
    statusPromise = (async () => {
      const binary = findCli();
      if (!binary) return remember(emptyStatus(false));
      return probeAccount(binary);
    })().finally(() => { statusPromise = null; });
    return statusPromise;
  }

  async function signIn() {
    if (logoutPromise) return { ok: false, error: 'Google logout is in progress. Try again when it finishes.' };
    if (loginPromise) return loginPromise;
    if (shuttingDown) return { ok: false, error: 'Jarvis is closing.' };
    const binary = findCli();
    if (!binary) return { ok: false, error: 'Install Antigravity CLI (agy) to connect your Google account.' };
    try { assertAccountMode(); assertIsolatedCustomizations(); } catch (error) { return { ok: false, error: error.message }; }
    invalidate();
    const generation = ++loginGeneration;
    loginPromise = (async () => {
      if (statusPromise) await statusPromise;
      if (generation !== loginGeneration || shuttingDown) return { ok: false, error: 'Google sign-in cancelled.' };
      invalidate();
      const check = await command(binary, ['--print', '/usage', '--print-timeout', '60s'], {
        allowLogin: true, timeout: 90000, onController: (controller) => { login = controller; },
      }).result;
      if (check.cancelled) return { ok: false, error: 'Google sign-in cancelled.' };
      if (check.failure) return { ok: false, error: check.failure };
      const account = check.code === 0 && !check.timedOut ? parseUsage(check.stdout) : null;
      if (!account) return { ok: false, error: 'Google sign-in did not complete. Finish the browser sign-in and try again.' };
      remember(account);
      return { ok: true, status: account };
    })().finally(() => { login = null; loginPromise = null; });
    return loginPromise;
  }

  async function cancel() {
    loginGeneration++;
    const pending = login;
    pending?.cancel();
    if (loginPromise) await loginPromise;
    invalidate();
  }

  async function signOut() {
    if (logoutPromise) return logoutPromise;
    logoutPromise = (async () => {
      await cancel();
      // A previous account probe must finish before credentials are removed.
      // Never reuse its cached result as post-logout verification.
      if (statusPromise) await statusPromise;
      if (shuttingDown) return { ok: false, error: 'Jarvis is closing.' };
      const binary = findCli();
      if (!binary) return { ok: false, error: 'Antigravity CLI is not installed.' };
      try { assertAccountMode(); assertIsolatedCustomizations(); } catch (error) { return { ok: false, error: error.message }; }
      invalidate();
      const result = await command(binary, ['--print', '/logout', '--print-timeout', '10s']).result;
      if (result.authRequired) { remember(emptyStatus(true)); return { ok: true }; }
      if (result.code !== 0 || result.failure || result.timedOut || result.cancelled) {
        return { ok: false, error: 'Antigravity could not log out. Run /logout in Antigravity CLI.' };
      }
      if (shuttingDown) return { ok: false, error: 'Jarvis is closing.' };
      const after = await probeAccount(binary);
      return !after.connected && !after.error
        ? { ok: true }
        : { ok: false, error: 'Google logout was not confirmed. Run /logout in Antigravity CLI.' };
    })().finally(() => { logoutPromise = null; });
    return logoutPromise;
  }

  /**
   * @param {{ request: any, continuation?: any, updates?: any[] }} input
   * @param {(event: {type: 'delta', text: string}) => void} emit
   */
  function openAttempt({ request, continuation, updates = [] }, emit) {
    let child;
    let req;
    let selectedModel;
    let sessionId = null;
    let initialized = false;
    let finished = false;
    let stopped = false;
    let interrupted = false;
    let unexpectedTool = false;
    let failure = null;
    let result = null;
    let text = '';
    let buffer = '';
    let stderr = '';
    let graceTimer;
    let killTimer;
    let runTimer;
    let initTimer;
    let workingDirectory;
    let preparation = null;
    let resolveSettled;
    const decoder = new StringDecoder('utf8');
    const settled = new Promise((resolve) => { resolveSettled = resolve; });
    const listeners = [];
    const on = (target, event, listener) => { target.on(event, listener); listeners.push([target, event, listener]); };
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      for (const timer of [graceTimer, killTimer, runTimer, initTimer]) clearTimeout(timer);
      for (const [target, event, listener] of listeners) target.removeListener(event, listener);
      if (workingDirectory) {
        try { files.rmSync(workingDirectory, { recursive: true, force: true }); } catch { /* Retain failed-cleanup scratch data rather than hide the task result. */ }
      }
      activeAttempts.delete(handle);
      resolveSettled(outcome);
    };
    const saved = (pending = false) => ({
      provider: 'gemini', version: 1, model: req.model, modelSlug: selectedModel,
      conversationId: req.conversationId,
      messages: [...req.messages, ...(text ? [{ role: 'assistant', content: pending ? `[Incomplete interrupted response]\n${text}` : text }] : [])],
    });
    const terminate = () => {
      if (!child || finished) return;
      signalChild(child, 'SIGTERM');
      if (!killTimer) {
        killTimer = setTimeout(() => { if (!finished) signalChild(child, 'SIGKILL'); }, KILL_GRACE_MS);
        killTimer.unref?.();
      }
    };
    const beforeSpawn = () => {
      if (finished) return true;
      if (stopped || shuttingDown) { finish({ kind: 'failed', error: 'Stopped.' }); return true; }
      if (interrupted && req) { finish({ kind: 'interrupted', continuation: saved(true) }); return true; }
      return false;
    };
    const handle = {
      settled,
      stop() {
        if (finished || stopped) return;
        stopped = true;
        preparation?.cancel();
        if (child) terminate();
        else if (!preparation) beforeSpawn();
      },
      interrupt() {
        if (finished || stopped || interrupted) return;
        interrupted = true;
        preparation?.cancel();
        if (!child) { if (!preparation) beforeSpawn(); return; }
        signalChild(child, 'SIGINT');
        graceTimer = setTimeout(terminate, KILL_GRACE_MS);
        graceTimer.unref?.();
      },
    };
    activeAttempts.add(handle);
    const fail = (message) => { failure ||= message; terminate(); };
    const sendDelta = (delta) => {
      if (stopped || interrupted || failure) return;
      if (Buffer.byteLength(text) + Buffer.byteLength(delta) > MAX_OUTPUT_BYTES) { fail('Gemini output exceeded the 4 MB limit. Partial output was preserved.'); return; }
      text += delta;
      if (!stopped && !failure) emit({ type: 'delta', text: delta });
    };
    const sameModel = (a, b) => typeof a === 'string' && a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');
    const readLine = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { fail('Gemini returned an invalid event stream.'); return; }
      if (!event || typeof event !== 'object') { fail('Gemini returned an invalid event stream.'); return; }
      if (event.event === 'init') {
        if (initialized || !/^[\w-]{1,100}$/.test(event.conversation_id ?? '')
          || event.init?.agent !== AGENT_NAME || !sameModel(event.init?.model, selectedModel)
          || !Array.isArray(event.init?.tools) || event.init.tools.length !== 0) {
          fail('Antigravity did not confirm the selected Gemini model and tool-free chat agent. No further work was accepted.');
          return;
        }
        initialized = true;
        sessionId = event.conversation_id;
        clearTimeout(initTimer);
        if (!stopped && !interrupted && !failure) child.stdin.end(promptFor(req.messages));
      } else if (event.event === 'step_update') {
        const step = event.step_update;
        if (!initialized || step?.conversation_id !== sessionId) { fail('Gemini returned an unexpected conversation stream.'); return; }
        if (step.step_type === 'tool' || step.subagent_info) {
          unexpectedTool = true;
          fail('Antigravity attempted a tool in a chat without tools. The task was stopped.');
        } else if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') sendDelta(step.text_delta);
      } else if (event.event === 'result') {
        if (event.result?.status === 'ERROR' && !initialized) { result = event.result; return; }
        if (!initialized || event.result?.conversation_id !== sessionId || result) { fail('Gemini returned an unexpected result.'); return; }
        result = event.result;
      }
    };
    void (async () => {
      try {
        const base = validateRequest(request);
        const cleanUpdates = updates.length ? validateMessages(updates) : [];
        if (cleanUpdates.some((message) => message.role !== 'user')) throw new Error('Queued messages must be from the user.');
        if (continuation && (continuation.provider !== 'gemini' || continuation.version !== 1
          || continuation.model !== base.model || continuation.conversationId !== base.conversationId
          || !cleanUpdates.length)) throw new Error('Invalid Gemini continuation. Queued messages were not applied.');
        req = validateRequest({ ...request, messages: [...(continuation?.messages ?? base.messages), ...cleanUpdates] });
        if (beforeSpawn()) return;
        const binary = findCli();
        if (!binary) throw new Error('Install Antigravity CLI (agy) to use Gemini.');
        assertAccountMode();
        assertIsolatedCustomizations();
        preparation = command(binary, ['--print', '/usage', '--print-timeout', '10s']);
        const account = await preparation.result;
        preparation = null;
        if (beforeSpawn()) return;
        if (account.code !== 0 || account.authRequired || !parseUsage(account.stdout)) throw new Error('Sign in to Gemini in Settings before sending a message.');
        if (continuation?.modelSlug) selectedModel = continuation.modelSlug;
        else {
          preparation = command(binary, ['models']);
          const listing = await preparation.result;
          preparation = null;
          if (beforeSpawn()) return;
          const models = listing.code === 0 ? parseModels(listing.stdout) : [];
          selectedModel = req.model === 'gemini-default' ? models[0]?.id : models.find((model) => model.id === req.model)?.id;
        }
        if (!/^gemini-[a-z0-9][a-z0-9.-]{0,95}$/i.test(selectedModel ?? '')) throw new Error('No matching Gemini model is available from Antigravity CLI.');
        if (beforeSpawn()) return;
        assertAccountMode();
        assertIsolatedCustomizations();
        workingDirectory = workspace(true);
        child = spawn(binary, buildArgs(req, selectedModel), { cwd: workingDirectory, env: accountEnvironment(environment),
          detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        on(child.stdout, 'data', (data) => {
          buffer += decoder.write(data);
          if (Buffer.byteLength(buffer) > MAX_OUTPUT_BYTES) { buffer = ''; fail('Gemini output exceeded the 4 MB limit.'); return; }
          let newline;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line && !failure) readLine(line);
          }
        });
        on(child.stderr, 'data', (data) => {
          stderr = (stderr + data.toString('utf8')).slice(-4000);
          if (AUTH_REQUIRED.test(stderr)) fail('Sign in to Gemini in Settings before sending a message.');
        });
        on(child.stdin, 'error', () => fail('Could not send the conversation to Gemini.'));
        on(child, 'error', () => { failure = 'Could not start Antigravity CLI.'; });
        on(child, 'close', (code, signal) => {
          buffer += decoder.end();
          if (buffer.trim() && !failure) readLine(buffer.trim());
          if (stopped || shuttingDown) return finish({ kind: 'failed', error: 'Stopped.' });
          if (failure) return finish({ kind: 'failed', error: failure, ...(unexpectedTool ? { uncertainEffects: true } : {}) });
          if (interrupted) return finish({ kind: 'interrupted', continuation: saved(true) });
          if (typeof result?.response === 'string' && result.response !== text) {
            if (result.response.startsWith(text)) sendDelta(result.response.slice(text.length));
            else return finish({ kind: 'failed', error: 'Gemini response did not match its stream. Partial output was preserved.' });
          }
          if (failure) return finish({ kind: 'failed', error: failure });
          if (code !== 0 || signal || result?.status !== 'SUCCESS' || !initialized) {
            return finish({ kind: 'failed', error: AUTH_REQUIRED.test(stderr) ? 'Sign in to Gemini in Settings.' : 'Gemini did not complete its response. Try again or check Antigravity CLI.' });
          }
          finish({ kind: 'complete', continuation: saved() });
        });
        runTimer = setTimeout(() => fail('Gemini timed out. Partial output was preserved.'), 330000);
        runTimer.unref?.();
        initTimer = setTimeout(() => fail('Antigravity did not confirm a tool-free Gemini session before receiving your message. This CLI version is not compatible with Jarvis chat.'), 15000);
        initTimer.unref?.();
      } catch (error) {
        if (child) fail(error.message || 'Could not reach Gemini.');
        else finish({ kind: 'failed', error: error.message || 'Could not reach Gemini.' });
      }
    })();
    return handle;
  }

  function registerIpc(ipcMain) {
    ipcMain.handle('gemini:status', () => status());
    ipcMain.handle('gemini:sign-in', () => signIn());
    ipcMain.handle('gemini:cancel', () => cancel());
    ipcMain.handle('gemini:sign-out', () => signOut());
  }

  function shutdown() {
    shuttingDown = true;
    loginGeneration++;
    const pending = [...activeAttempts].map((attempt) => attempt.settled)
      .concat([...activeCommands].map((command) => command.result));
    for (const attempt of activeAttempts) attempt.stop();
    for (const pending of activeCommands) pending.cancel();
    return Promise.all(pending);
  }

  return { status, signIn, signOut, cancel, shutdown, registerIpc, openAttempt, findCli };
}

module.exports = { ...createAdapter(), createAdapter, accountEnvironment, parseUsage, parseModels,
  validateRequest, buildArgs, promptFor, AGENT_NAME, AGENT_PROFILE };
