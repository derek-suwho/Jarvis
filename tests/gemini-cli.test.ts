import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import gemini from '../electron/gemini-cli.cjs';

// Protocol examples follow Google's headless docs. The quota fragment is
// transcribed from https://antigravity.google/assets/image/docs/cli/usage-tui.png;
// successful --print /usage output still needs an authenticated live check.
const USAGE = '└ Models & Quota\n\nAccount:\n\nGEMINI MODELS\nModels within this group: Gemini Flash, Gemini Pro\nWeekly Limit\n94% remaining · Refreshes in 155h 41m\n';
const MODELS = 'claude-example-high  Another vendor\ngemini-4-argon-high  Gemini 4 Argon (High)\ngemini-3.8-flash-medium  Gemini 3.8 Flash (Medium)\n';
const OAUTH = 'https://accounts.google.com/o/oauth2/auth?client_id=fixture&code_challenge=fixture&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&state=fixture';
const req = (extra = {}) => ({ model: 'gemini-default', mode: 'chat', reasoning: 'High', conversationId: 'chat-1', messages: [{ role: 'user', content: 'Hello' }], ...extra });

class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  kill = vi.fn();
  pid: number;
  closed = false;
  constructor(pid: number) { super(); this.pid = pid; }
  close(code: number | null = 0, signal: string | null = null) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, signal);
  }
  out(text: string) { this.stdout.emit('data', Buffer.from(text)); }
  err(text: string) { this.stderr.emit('data', Buffer.from(text)); }
  event(event: object) { this.out(JSON.stringify(event) + '\n'); }
}

type SpawnStep = (child: Child, args: string[], options: any) => void;
type FixtureOptions = { steps?: SpawnStep[]; files?: Record<string, string>; directories?: Record<string, string[]>; installed?: boolean; autoClose?: boolean; env?: object };
function fixture(options: FixtureOptions = {}) {
  const children: Child[] = [];
  const steps = [...(options.steps ?? [])];
  const missing = () => Object.assign(new Error('Missing fixture file'), { code: 'ENOENT' });
  const files = {
    accessSync: vi.fn((file: string) => { if (options.installed === false || file !== '/test/agy') throw missing(); }),
    statSync: vi.fn(() => ({ isFile: () => true })),
    readFileSync: vi.fn((file: string) => {
      if (!(file in (options.files ?? {}))) throw missing();
      return options.files![file];
    }),
    readdirSync: vi.fn((directory: string) => {
      if (!(directory in (options.directories ?? {}))) throw missing();
      return options.directories![directory];
    }),
    mkdirSync: vi.fn(), writeFileSync: vi.fn(), rmSync: vi.fn(),
  };
  const spawn = vi.fn((_binary: string, args: string[], settings: any) => {
    const child = new Child(1000 + children.length);
    children.push(child);
    const step = steps.shift();
    if (step) queueMicrotask(() => step(child, args, settings));
    return child;
  });
  const kill = vi.fn((pid: number, signal: string) => {
    const child = children.find((candidate) => candidate.pid === -pid);
    if (options.autoClose !== false) queueMicrotask(() => child?.close(null, signal));
  });
  const openExternal = vi.fn(async (_url: string) => {});
  const adapter = gemini.createAdapter({ spawn, fs: files, env: { JARVIS_GEMINI_CLI: '/test/agy', PATH: '', ...options.env },
    home: '/test/home', platform: 'darwin', userData: () => '/test/user-data', kill, openExternal });
  return { adapter, spawn, files, children, kill, openExternal };
}

const output = (text: string): SpawnStep => (child) => { child.out(text); child.close(); };
const initialized = (child: Child, model = 'gemini-4-argon-high', tools: string[] = []) => child.event({
  event: 'init', conversation_id: 'provider-session-1', init: { agent: 'jarvis-chat', model, tools },
});
const delta = (child: Child, text: string) => child.event({ event: 'step_update', step_update: {
  conversation_id: 'provider-session-1', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: text,
} });
const completed = (child: Child, text: string, status = 'SUCCESS') => child.event({
  event: 'result', result: { conversation_id: 'provider-session-1', status, response: text },
});
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

afterEach(() => vi.useRealTimers());

describe('Gemini account connection', () => {
  it('reports missing installation without creating a connected flag', async () => {
    const { adapter, spawn } = fixture({ installed: false });
    expect(await adapter.status()).toEqual({ installed: false, connected: false, name: null, email: null, plan: null });
    expect(await adapter.signIn()).toMatchObject({ ok: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('verifies a usage report, dedupes concurrent probes, and caches briefly', async () => {
    const { adapter, spawn } = fixture({ steps: [output(USAGE)] });
    const [first, second] = await Promise.all([adapter.status(), adapter.status()]);
    expect(first).toEqual({ installed: true, connected: true, name: null, email: null, plan: null });
    expect(second).toEqual(first);
    expect(await adapter.status()).toEqual(first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(['--print', '/usage', '--print-timeout', '10s', '--agent', 'jarvis-chat']);
  });

  it('does not infer connected status from unrelated success text or local files', async () => {
    const { adapter } = fixture({ steps: [output('CLI started successfully\n')] });
    expect(await adapter.status()).toMatchObject({ installed: true, connected: false, error: expect.any(String) });
  });

  it('kills an auth-required status probe without opening or returning its OAuth URL', async () => {
    const { adapter, openExternal, kill } = fixture({ steps: [(child) => child.err(`Authentication required.\n${OAUTH}\n`)] });
    const status = await adapter.status();
    expect(status).toEqual({ installed: true, connected: false, name: null, email: null, plan: null });
    expect(openExternal).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(-1000, 'SIGTERM');
    expect(JSON.stringify(status)).not.toContain('accounts.google.com');
  });

  it('opens Google only for explicit sign-in and confirms provider usage before success', async () => {
    const { adapter, children, openExternal } = fixture();
    const pending = adapter.signIn();
    children[0].out('Authentication required.\n');
    children[0].out(OAUTH.slice(0, 60));
    await flush();
    expect(openExternal).not.toHaveBeenCalled();
    children[0].out(OAUTH.slice(60) + '\n');
    await flush();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(OAUTH);
    children[0].out(USAGE);
    children[0].close();
    expect(await pending).toMatchObject({ ok: true, status: { connected: true } });
    expect(await adapter.status()).toMatchObject({ connected: true });
  });

  it('rejects a terminal auth failure even after a quota report was printed', () => {
    expect(gemini.parseUsage(`${USAGE}\nError: authentication failed.\n`)).toBeNull();
    expect(gemini.parseUsage(`Authentication required.\n${OAUTH}\n${USAGE}`)).toMatchObject({ connected: true });
  });

  it('rejects OAuth links to another callback and cancels the owned process', async () => {
    const { adapter, children, openExternal, kill } = fixture();
    const pending = adapter.signIn();
    children[0].err(`Authentication required.\n${OAUTH.replace('antigravity.google', 'example.com')}\n`);
    await flush();
    expect(openExternal).not.toHaveBeenCalled();
    await adapter.cancel();
    expect(await pending).toEqual({ ok: false, error: 'Google sign-in cancelled.' });
    expect(kill).toHaveBeenCalledWith(-1000, 'SIGTERM');
  });

  it('reports browser-launch errors and cleans up the sign-in process', async () => {
    const { adapter, children, openExternal, kill } = fixture();
    openExternal.mockRejectedValueOnce(new Error('Browser failed'));
    const pending = adapter.signIn();
    children[0].err(`Authentication required.\n${OAUTH}\n`);
    expect(await pending).toMatchObject({ ok: false, error: 'Could not open Google sign-in. Check your default browser and try again.' });
    expect(kill).toHaveBeenCalledWith(-1000, 'SIGTERM');
  });

  it('times out status and escalates cleanup without releasing before close', async () => {
    vi.useFakeTimers();
    const { adapter, children, kill } = fixture({ autoClose: false });
    let settled = false;
    const pending = adapter.status().then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(15000);
    expect(kill).toHaveBeenLastCalledWith(-1000, 'SIGTERM');
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(kill).toHaveBeenLastCalledWith(-1000, 'SIGKILL');
    children[0].close(null, 'SIGKILL');
    expect(await pending).toMatchObject({ connected: false, error: 'Antigravity account check timed out. Try again.' });
  });

  it('confirms logout by a new provider probe; shared CLI credentials are not edited by Jarvis', async () => {
    const { adapter, spawn } = fixture({ steps: [output('Logged out.\n'), (child) => child.err('Authentication required.\n')] });
    expect(await adapter.signOut()).toEqual({ ok: true });
    expect(spawn.mock.calls.map((call) => call[1][1])).toEqual(['/logout', '/usage']);
  });

  it('does not report logout when the provider still accepts the account', async () => {
    const { adapter } = fixture({ steps: [output('Logged out.\n'), output(USAGE)] });
    expect(await adapter.signOut()).toMatchObject({ ok: false });
  });

  it('serializes logout behind the prior probe, dedupes logout, and fences concurrent login', async () => {
    const { adapter, children, spawn } = fixture({ steps: [() => {}, output('Logged out.\n'), (child) => child.err('Authentication required.\n')] });
    const oldProbe = adapter.status();
    const logout = adapter.signOut();
    const secondLogout = adapter.signOut();
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(await adapter.signIn()).toMatchObject({ ok: false, error: expect.stringContaining('logout is in progress') });
    expect(await adapter.status()).toMatchObject({ connected: false });
    children[0].out(USAGE);
    children[0].close();
    await oldProbe;
    expect(await logout).toEqual({ ok: true });
    expect(await secondLogout).toEqual({ ok: true });
    expect(spawn.mock.calls.map((call) => call[1][1])).toEqual(['/usage', '/logout', '/usage']);
    expect(await adapter.status()).toMatchObject({ connected: false });
  });

  it('refuses API-key and enterprise configuration and strips billing environment overrides', async () => {
    const { adapter, spawn } = fixture({ files: {
      '/test/home/.gemini/antigravity-cli/settings.json': JSON.stringify({ modelProvider: 'gemini' }),
    } });
    expect(await adapter.status()).toMatchObject({ connected: false, error: expect.stringContaining('API-key') });
    expect(await adapter.signIn()).toMatchObject({ ok: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(gemini.accountEnvironment({ PATH: '/test', GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret',
      AGY_ADC_AUTH: 'true', GOOGLE_APPLICATION_CREDENTIALS: '/secret.json', GOOGLE_GENAI_USE_VERTEXAI: 'true',
      GOOGLE_CLOUD_PROJECT: 'billed-project', GOOGLE_GEMINI_BASE_URL: 'https://example.com' }))
      .toEqual({ PATH: '/test', NO_COLOR: '1', TERM: 'dumb' });
  });

  it.each<FixtureOptions>([
    { files: { '/test/home/.gemini/config/hooks.json': '{"session-init":{"SessionStart":[{"command":"example"}]}}' } },
    { directories: { '/test/home/.gemini/antigravity-cli/plugins': ['example-plugin'] },
      files: { '/test/home/.gemini/antigravity-cli/plugins/example-plugin/hooks.json': '{"example":{"Stop":[{"command":"example"}]}}' } },
  ])('does not launch account probes, login, or logout with global hooks/plugins', async (customizations) => {
    const { adapter, spawn, openExternal } = fixture(customizations);
    expect(await adapter.status()).toMatchObject({ connected: false, error: expect.stringContaining('command hooks') });
    expect(await adapter.signIn()).toMatchObject({ ok: false, error: expect.stringContaining('command hooks') });
    expect(await adapter.signOut()).toMatchObject({ ok: false, error: expect.stringContaining('command hooks') });
    expect(spawn).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('accepts disabled hooks, user text rules, and normal MCP configuration', async () => {
    const { adapter } = fixture({ steps: [output(USAGE)], files: {
      '/test/home/.gemini/config/hooks.json': '{"example":{"enabled":false,"SessionStart":[{"command":"example"}]}}',
      '/test/home/.gemini/config/mcp_config.json': '{"mcpServers":{"example":{"command":"example"}}}',
      '/test/home/.gemini/GEMINI.md': 'User-owned global text instructions',
    } });
    expect(await adapter.status()).toMatchObject({ connected: true });
  });

  it('shutdown cancels a pending login and prevents another login', async () => {
    const { adapter, kill } = fixture();
    const pending = adapter.signIn();
    adapter.shutdown();
    expect(await pending).toMatchObject({ ok: false });
    expect(kill).toHaveBeenCalledWith(-1000, 'SIGTERM');
    expect(await adapter.signIn()).toEqual({ ok: false, error: 'Jarvis is closing.' });
  });

  it('shutdown drains owned processes through forced termination before resolving', async () => {
    vi.useFakeTimers();
    const { adapter, children, kill } = fixture({ autoClose: false });
    const login = adapter.signIn();
    let drained = false;
    const shutdown = adapter.shutdown().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(kill).toHaveBeenLastCalledWith(-1000, 'SIGKILL');
    expect(drained).toBe(false);
    children[0].close(null, 'SIGKILL');
    await shutdown;
    expect(drained).toBe(true);
    expect(await login).toMatchObject({ ok: false });
  });

  it('cancel during an existing status probe never starts a later login process', async () => {
    const { adapter, children, spawn, openExternal } = fixture();
    const probe = adapter.status();
    const signIn = adapter.signIn();
    const cancel = adapter.cancel();
    children[0].err('Authentication required.\n');
    await probe;
    await cancel;
    expect(await signIn).toEqual({ ok: false, error: 'Google sign-in cancelled.' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('registers the four Gemini auth IPC handlers', () => {
    const { adapter } = fixture();
    const handle = vi.fn();
    adapter.registerIpc({ handle });
    expect(handle.mock.calls.map((call) => call[0])).toEqual(['gemini:status', 'gemini:sign-in', 'gemini:cancel', 'gemini:sign-out']);
  });
});

describe('Gemini chat boundary and protocol', () => {
  it('rejects binary media explicitly and preserves text attachments/instructions', () => {
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    expect(() => gemini.validateRequest(req({ messages: [{ role: 'user', content: 'Analyze', media: [image] }] }))).toThrow('text only');
    expect(() => gemini.validateRequest(req({ model: 'claude-example' }))).toThrow('Gemini model');
    const valid = gemini.validateRequest(req({ messages: [{ role: 'user', content: 'User instructions: be brief\nAttached text: report' }] }));
    expect(JSON.parse(gemini.promptFor(valid.messages)).message.content).toContain('User instructions: be brief');
    expect(JSON.parse(gemini.promptFor(valid.messages)).message.content).toContain('Attached text: report');
  });

  it('uses a Gemini model from the actual CLI list, fresh workspace, and an explicit no-tools primary agent', async () => {
    const deltas: any[] = [];
    const { adapter, spawn, files, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, (event: any) => deltas.push(event));
    await flush();
    const child = children[2];
    expect(child.stdin.end).not.toHaveBeenCalled();
    initialized(child);
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(JSON.parse(child.stdin.end.mock.calls[0][0]).message.content).toContain('Hello');
    delta(child, 'Hello ');
    delta(child, 'world');
    completed(child, 'Hello world');
    child.close();
    const outcome = await handle.settled;
    expect(outcome).toMatchObject({ kind: 'complete', continuation: { provider: 'gemini', modelSlug: 'gemini-4-argon-high' } });
    expect(deltas).toEqual([{ type: 'delta', text: 'Hello ' }, { type: 'delta', text: 'world' }]);
    const args = spawn.mock.calls[2][1];
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-argon-high');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--continue');
    expect(args).not.toContain('--conversation');
    expect(spawn.mock.calls[2][2].cwd).toMatch(/^\/test\/user-data\/gemini-workspace\/[\w-]+$/);
    expect(spawn.mock.calls[2][2].cwd).not.toBe(spawn.mock.calls[0][2].cwd);
    expect(files.writeFileSync.mock.calls.some((call) => call[1].includes('tools: []') && call[1].includes('commandExecutionPolicy: off'))).toBe(true);
    expect(files.rmSync).toHaveBeenCalledWith(spawn.mock.calls[2][2].cwd, { recursive: true, force: true });
  });

  it.each([
    ['wrong vendor', 'claude-example-high', []],
    ['unexpected tool', 'gemini-4-argon-high', ['run_command']],
  ])('sends no prompt when init has %s', async (_label, model, tools) => {
    const { adapter, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    await flush();
    initialized(children[2], model as string, tools as string[]);
    const outcome = await handle.settled;
    expect(outcome.kind).toBe('failed');
    expect(children[2].stdin.end).not.toHaveBeenCalled();
  });

  it('fails closed if the CLI needs a prompt before emitting initialization', async () => {
    vi.useFakeTimers();
    const { adapter, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await handle.settled).toMatchObject({ kind: 'failed', error: expect.stringContaining('not compatible') });
    expect(children[2].stdin.end).not.toHaveBeenCalled();
  });

  it('refuses enabled session hooks before starting chat', async () => {
    const { adapter, spawn } = fixture({ files: { '/test/home/.gemini/config/hooks.json': '{"example":{"SessionStart":[{"command":"example"}]}}' } });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    expect(await handle.settled).toMatchObject({ kind: 'failed', error: expect.stringContaining('command hooks') });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('handles split UTF-8 and a final result without a trailing newline', async () => {
    const emitted: any[] = [];
    const { adapter, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, (event: any) => emitted.push(event));
    await flush();
    const child = children[2];
    initialized(child);
    const event = Buffer.from(JSON.stringify({ event: 'step_update', step_update: {
      conversation_id: 'provider-session-1', step_type: 'agent_response', text_delta: 'Hello 🌍',
    } }) + '\n');
    const split = event.indexOf(Buffer.from('🌍')) + 2;
    child.stdout.emit('data', event.subarray(0, split));
    child.stdout.emit('data', event.subarray(split));
    child.out(JSON.stringify({ event: 'result', result: { conversation_id: 'provider-session-1', status: 'SUCCESS', response: 'Hello 🌍' } }));
    child.close();
    expect(await handle.settled).toMatchObject({ kind: 'complete' });
    expect(emitted).toEqual([{ type: 'delta', text: 'Hello 🌍' }]);
  });

  it('does not confuse exit zero or partial text with completion', async () => {
    const { adapter, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    await flush();
    initialized(children[2]);
    delta(children[2], 'Partial');
    children[2].close();
    expect(await handle.settled).toMatchObject({ kind: 'failed' });
  });

  it('stops unexpected tool events and preserves uncertainty instead of replaying actions', async () => {
    const { adapter, children } = fixture({ steps: [output(USAGE), output(MODELS)] });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    await flush();
    initialized(children[2]);
    children[2].event({ event: 'step_update', step_update: { conversation_id: 'provider-session-1', step_type: 'tool', tool_name: 'write_file' } });
    expect(await handle.settled).toMatchObject({ kind: 'failed', uncertainEffects: true });
  });

  it('interrupts after process close, then replays explicit history in a fresh queued attempt', async () => {
    const { adapter, children, spawn } = fixture({ steps: [output(USAGE), output(MODELS), () => {}, output(USAGE)] });
    const emit = vi.fn();
    const first = adapter.openAttempt({ request: req() }, emit);
    await flush();
    initialized(children[2]);
    delta(children[2], 'Partial response');
    first.interrupt();
    delta(children[2], 'Late response');
    const outcome = await first.settled;
    expect(outcome.kind).toBe('interrupted');
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'delta', text: 'Partial response' });
    expect(JSON.stringify(outcome.continuation)).not.toContain('Late response');
    const second = adapter.openAttempt({ request: req(), continuation: outcome.continuation,
      updates: [{ role: 'user', content: 'Use a table' }] }, vi.fn());
    await flush();
    initialized(children[4]);
    const prompt = children[4].stdin.end.mock.calls[0][0];
    expect(prompt).toContain('Partial response');
    expect(prompt).toContain('Use a table');
    expect(spawn.mock.calls[4][1]).not.toContain('--conversation');
    expect(spawn.mock.calls[4][2].cwd).not.toBe(spawn.mock.calls[2][2].cwd);
    completed(children[4], 'Updated');
    children[4].close();
    expect(await second.settled).toMatchObject({ kind: 'complete' });
  });

  it('stopping during preparation cancels that process and never spawns generation', async () => {
    const { adapter, children, spawn, kill } = fixture({ autoClose: false });
    const handle = adapter.openAttempt({ request: req() }, vi.fn());
    expect(children).toHaveLength(1);
    let settled = false;
    void handle.settled.then(() => { settled = true; });
    handle.stop();
    await flush();
    expect(settled).toBe(false);
    children[0].close(null, 'SIGTERM');
    expect(await handle.settled).toMatchObject({ kind: 'failed', error: 'Stopped.' });
    await flush();
    expect(kill).toHaveBeenCalledWith(-1000, 'SIGTERM');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
