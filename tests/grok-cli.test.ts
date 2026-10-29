import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../electron/grok-cli.cjs', import.meta.url), 'utf8')
const roots: string[] = []
const adapters: any[] = []
const tick = async () => { for (let n = 0; n < 40; n++) await Promise.resolve() }

class Child extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() })
  kill = vi.fn((signal = 'SIGTERM') => { if (this.autoClose) queueMicrotask(() => this.close(null, signal)); return true })
  autoClose = true
  closed = false
  args: string[] = []
  options: any
  line(value: unknown) { this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')) }
  close(code: number | null = 0, signal: string | null = null) {
    if (!this.closed) { this.closed = true; this.emit('close', code, signal) }
  }
}

function harness(options: { installed?: boolean; connected?: boolean; rpc?: (message: any, child: Child) => boolean; version?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-grok-test-')); roots.push(root)
  const binary = path.join(root, 'grok')
  if (options.installed !== false) writeFileSync(binary, '')
  const state = { connected: options.connected ?? true, method: 'cached_token', gate: null as any, plan: 'SuperGrok', blocked: false }
  const children: Child[] = []
  const spawn = vi.fn((_bin: string, args: string[], processOptions: any) => {
    const child = new Child(); child.args = args; child.options = processOptions; children.push(child)
    if (args[0] === '--version') queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`grok ${options.version ?? '1.0.70'} (fixture)\n`)); child.close()
    })
    if (args[0] === 'agent') child.stdin.write.mockImplementation((input: string) => {
      const message = JSON.parse(input)
      if (!message.method) return true
      queueMicrotask(() => {
        if (options.rpc?.(message, child)) return
        let result: any = {}
        if (message.method === 'initialize') result = { protocolVersion: 1, authMethods: state.connected ? [{ id: 'cached_token' }, { id: 'grok.com' }] : [{ id: 'grok.com' }] }
        if (message.method === '_x.ai/auth/check_subscription') result = { authenticated: state.connected, meta: { auth_mode: 'Oidc', subscription_tier: state.plan, gate: state.gate, ignored_secret: 'never-render-me' } }
        if (message.method === '_x.ai/auth/info') result = { methodId: state.method, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', userBlockedReason: state.blocked ? 'blocked' : null, teamBlockedReasons: [], ignored_secret: 'never-render-me' }
        child.line({ jsonrpc: '2.0', id: message.id, result })
      })
      return true
    })
    return child
  })
  const mod = { exports: {} as any }
  runInNewContext(source, { module: mod, exports: mod.exports, Buffer, process, setTimeout, clearTimeout,
    __dirname: path.resolve('electron'), require(name: string) {
      if (name === 'electron') return { app: { getPath: () => root } }
      return name.startsWith('./') ? require(path.resolve('electron', name)) : require(name)
    } })
  const adapter = mod.exports.createGrokCli({ spawn, getUserData: () => root, homedir: () => root,
    env: { PATH: '', JARVIS_GROK_BIN: binary, XAI_API_KEY: 'never-forward-key', GROK_HOME: '/wrong', GROK_DEFAULT_MODEL: 'paid-model', GROK_CONFIG: 'malicious', LANG: 'en_US.UTF-8' } })
  // The factory deliberately checks well-known installs; tests without the fixture force no paths.
  adapters.push(adapter)
  return { root, binary, state, children, spawn, adapter,
    latest: (command: string) => children.filter((child) => child.args[0] === command).at(-1)! }
}

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.shutdown()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})

const request = { model: 'grok-default', mode: 'chat', conversationId: 'conversation-1',
  messages: [{ role: 'user', content: 'Follow these instructions: be brief.\nHello.' }] }

describe('Grok subscription authentication', () => {
  it('verifies cached OAuth and subscription access before exposing identity', async () => {
    const h = harness()
    const result = await h.adapter.status()
    expect(result).toEqual({ installed: true, connected: true, name: 'Ada Lovelace', email: 'ada@example.test', plan: 'SuperGrok' })
    expect(JSON.stringify(result)).not.toContain('never-render')
    const child = h.latest('agent')
    const sent = child.stdin.write.mock.calls.map(([line]) => JSON.parse(line))
    expect(sent.map((message) => message.method)).toEqual(['initialize', 'authenticate', '_x.ai/auth/check_subscription', '_x.ai/auth/info'])
    expect(sent[1].params).toEqual({ methodId: 'cached_token', _meta: { headless: true } })
    expect(child.closed).toBe(true)
    expect(child.options.env).not.toHaveProperty('XAI_API_KEY')
    expect(child.options.env).not.toHaveProperty('GROK_CONFIG')
    expect(child.options.env).not.toHaveProperty('GROK_DEFAULT_MODEL')
    expect(child.options.env.GROK_HOME).toBe(path.join(h.root, 'providers/grok'))
    expect(child.options.env.GROK_DISABLE_API_KEY_AUTH).toBe('1')
    expect(readFileSync(path.join(child.options.env.GROK_HOME, 'config.toml'), 'utf8')).toContain('preferred_method = "oidc"')
  })

  it('does not authenticate, open a browser, or claim a plan without a cached token', async () => {
    const h = harness({ connected: false })
    expect(await h.adapter.status()).toEqual({ installed: true, connected: false, name: null, email: null, plan: null })
    expect(h.latest('agent').stdin.write).toHaveBeenCalledTimes(1)
    expect(h.children.some((child) => child.args[0] === 'login')).toBe(false)
  })

  it('rejects API-key fallback and blocked subscription gates', async () => {
    const h = harness(); h.state.method = 'xai.api_key'
    expect(await h.adapter.status()).toMatchObject({ connected: false, error: expect.any(String) })
    h.state.method = 'cached_token'; h.state.gate = { message: 'Upgrade' }
    expect(await h.adapter.status()).toMatchObject({ connected: false, plan: 'SuperGrok', error: expect.stringContaining('access') })
    h.state.gate = null; h.state.blocked = true
    expect(await h.adapter.status()).toMatchObject({ connected: false })
  })

  it('deduplicates in-flight status and gives sanitized RPC errors', async () => {
    const h = harness({ rpc(message, child) {
      if (message.method !== 'authenticate') return false
      child.line({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'secret-token-error', data: 'secret' } }); return true
    } })
    const first = h.adapter.status(), second = h.adapter.status()
    expect(first).toBe(second)
    const result = await first
    expect(result).toMatchObject({ connected: false, error: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(h.children.filter((child) => child.args[0] === 'agent')).toHaveLength(1)
    expect(h.latest('agent').closed).toBe(true)
  })

  it('requires the supported CLI version', async () => {
    const h = harness({ version: '0.1.100' })
    expect(await h.adapter.status()).toMatchObject({ connected: false, error: expect.stringContaining('1.0.70') })
    expect(h.children).toHaveLength(1)
  })

  it.each(['invalid-json', 'unverified-subscription'])('rejects %s authentication replies', async (scenario) => {
    const h = harness({ rpc(message, child) {
      if (scenario === 'invalid-json' && message.method === 'initialize') {
        child.stdout.emit('data', Buffer.from('not-json\n')); return true
      }
      if (scenario === 'unverified-subscription' && message.method === '_x.ai/auth/check_subscription') {
        child.line({ jsonrpc: '2.0', id: message.id, result: { authenticated: false, meta: { subscription_tier: 'SuperGrok' } } }); return true
      }
      return false
    } })
    expect(await h.adapter.status()).toMatchObject({ connected: false, error: expect.any(String) })
    expect(h.latest('agent').closed).toBe(true)
  })

  it('times out and reaps an unresponsive ACP process', async () => {
    vi.useFakeTimers()
    const h = harness({ rpc() { return true } })
    const result = h.adapter.status(); await tick()
    const child = h.latest('agent'); child.autoClose = false
    await vi.advanceTimersByTimeAsync(25_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    let finished = false; result.then(() => { finished = true }); await tick()
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.close(null, 'SIGKILL')
    expect(await result).toMatchObject({ connected: false, error: expect.stringContaining('timed out') })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for login exit then verifies status, and deduplicates login', async () => {
    const h = harness({ connected: false })
    const first = h.adapter.signIn(); expect(h.adapter.signIn()).toBe(first); await tick()
    const child = h.latest('login')
    expect(child.args).toEqual(['login', '--oauth'])
    let finished = false; first.then(() => { finished = true }); await tick(); expect(finished).toBe(false)
    h.state.connected = true; child.close()
    expect(await first).toMatchObject({ ok: true, status: { connected: true } })
  })

  it('does not count browser-flow completion alone as sign-in', async () => {
    const h = harness({ connected: false })
    const result = h.adapter.signIn(); await tick(); h.latest('login').close()
    expect(await result).toMatchObject({ ok: false, status: { connected: false } })
  })

  it('reports a failed login process without probing or exposing stderr', async () => {
    const h = harness({ connected: false })
    const result = h.adapter.signIn(); await tick()
    h.latest('login').stderr.emit('data', Buffer.from('sensitive login diagnostics'))
    h.latest('login').close(1)
    expect(await result).toEqual({ ok: false, error: 'Grok sign-in did not finish. Try again.' })
    expect(h.children.some((child) => child.args[0] === 'agent')).toBe(false)
  })

  it('cancels only its owned login and waits for process closure', async () => {
    const h = harness({ connected: false })
    const result = h.adapter.signIn(); await tick()
    const child = h.latest('login'); child.autoClose = false
    const cancellation = h.adapter.cancel()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    let finished = false; cancellation.then(() => { finished = true }); await tick(); expect(finished).toBe(false)
    child.close(null, 'SIGTERM')
    expect(await result).toEqual({ ok: false, error: 'Grok sign-in cancelled.' })
    expect(await cancellation).toEqual({ ok: true })
    expect(h.children.filter((entry) => entry.args[0] === 'agent')).toHaveLength(0)
  })

  it('cancels before discovery/version check can launch a login', async () => {
    const h = harness()
    const result = h.adapter.signIn(); const cancelled = h.adapter.cancel()
    await cancelled
    expect(await result).toMatchObject({ ok: false })
    expect(h.children.some((child) => child.args[0] === 'login')).toBe(false)
  })

  it('verifies logout and preserves failures', async () => {
    const h = harness()
    const first = h.adapter.signOut(); await tick(); h.latest('logout').close(1)
    expect(await first).toMatchObject({ ok: false })
    const second = h.adapter.signOut(); await tick(); h.state.connected = false; h.latest('logout').close()
    expect(await second).toMatchObject({ ok: true, status: { connected: false } })
  })

  it('fences shutdown during preparation and refuses later subprocesses', async () => {
    const h = harness()
    const status = h.adapter.status()
    await h.adapter.shutdown()
    expect(await status).toMatchObject({ connected: false })
    expect(h.children.filter((child) => child.args[0] === 'agent')).toHaveLength(0)
    const count = h.spawn.mock.calls.length
    expect(await h.adapter.signIn()).toMatchObject({ ok: false })
    expect(await h.adapter.openAttempt({ request }, vi.fn()).settled).toMatchObject({ kind: 'failed' })
    expect(h.spawn).toHaveBeenCalledTimes(count)
  })
})

describe('Grok text turns', () => {
  it('streams split UTF-8 frames and preserves history, instructions, and queued continuation', async () => {
    const h = harness(); const emit = vi.fn()
    const turn = h.adapter.openAttempt({ request }, emit); await tick()
    const child = h.latest('--prompt-file')
    const promptPath = child.args[1]
    expect(readFileSync(promptPath, 'utf8')).toContain('Follow these instructions: be brief.')
    expect(child.args).toContain('read_file,search_tool,use_tool,Agent')
    expect(child.args).toContain('--verbatim')
    expect(child.args).toContain('dontAsk')
    expect(child.args).not.toContain('--always-approve')
    expect(child.args).not.toContain('--model')
    expect(child.args).not.toContain('Hello.')
    const text = Buffer.from(JSON.stringify({ type: 'text', data: 'Hello, 🌎' }) + '\n')
    child.stdout.emit('data', text.subarray(0, text.length - 5)); child.stdout.emit('data', text.subarray(text.length - 5))
    child.line({ type: 'thought', data: 'never-display-thought' })
    child.line({ type: 'end', stopReason: 'end_turn' })
    let finished = false; turn.settled.then(() => { finished = true }); await tick(); expect(finished).toBe(false)
    child.close()
    const result = await turn.settled
    expect(result.kind).toBe('complete')
    expect(emit.mock.calls).toEqual([[{ type: 'delta', text: 'Hello, 🌎' }]])
    expect(existsSync(promptPath)).toBe(false)
    const next = h.adapter.openAttempt({ request, continuation: result.continuation, updates: [{ role: 'user', content: 'And goodbye.' }] }, emit)
    await tick()
    const nextChild = h.latest('--prompt-file'), prompt = readFileSync(nextChild.args[1], 'utf8')
    expect(prompt).toContain('Hello, 🌎'); expect(prompt).toContain('And goodbye.'); expect(prompt).toContain('be brief')
    nextChild.line({ type: 'text', data: 'Goodbye.' }); nextChild.line({ type: 'end', stopReason: 'end_turn' }); nextChild.close()
    expect((await next.settled).kind).toBe('complete')
  })

  it('preserves partial replies on interrupt, waits for exit, and suppresses late output', async () => {
    const h = harness(); const emit = vi.fn()
    const turn = h.adapter.openAttempt({ request }, emit); await tick()
    const child = h.latest('--prompt-file'); child.autoClose = false
    child.line({ type: 'text', data: 'Partial answer.' }); turn.interrupt()
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    child.line({ type: 'text', data: 'late output' })
    let finished = false; turn.settled.then(() => { finished = true }); await tick(); expect(finished).toBe(false)
    child.close(null, 'SIGINT')
    expect(await turn.settled).toMatchObject({ kind: 'interrupted', continuation: { messages: [...request.messages, { role: 'assistant', content: 'Partial answer.' }] } })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('stops before status finishes without launching a reply', async () => {
    const h = harness()
    const turn = h.adapter.openAttempt({ request }, vi.fn()); turn.stop()
    expect((await turn.settled).kind).toBe('interrupted')
    expect(h.children.some((child) => child.args[0] === '--prompt-file')).toBe(false)
  })

  it.each([
    { ...request, messages: [{ role: 'user', content: 'See image', media: [{ name: 'image.png', data: 'anything' }] }] },
    { ...request, mode: 'code' },
    { ...request, model: 'fabricated-grok-99' },
  ])('rejects unsupported inputs before spawning', async (payload) => {
    const h = harness()
    expect(await h.adapter.openAttempt({ request: payload }, vi.fn()).settled).toMatchObject({ kind: 'failed', error: expect.any(String) })
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each(['malformed', 'tool', 'error', 'missing-end', 'bad-exit'])('fails closed for %s output', async (scenario) => {
    const h = harness(); const turn = h.adapter.openAttempt({ request }, vi.fn()); await tick()
    const child = h.latest('--prompt-file')
    if (scenario === 'malformed') child.stdout.emit('data', Buffer.from('{broken\n'))
    if (scenario === 'tool') child.line({ type: 'tool_call', toolCallId: 'tool-1', title: 'Read' })
    if (scenario === 'error') child.line({ type: 'error', message: 'sensitive provider token' })
    if (scenario === 'bad-exit') child.line({ type: 'end', stopReason: 'end_turn' })
    child.close(scenario === 'bad-exit' ? 1 : 0)
    const result = await turn.settled
    expect(result.kind).toBe('failed')
    expect(result.error).not.toContain('sensitive')
    if (scenario === 'tool') expect(result.uncertainEffects).toBe(true)
  })

  it('bounds malformed output and tears down all children on shutdown', async () => {
    const h = harness(); const turn = h.adapter.openAttempt({ request }, vi.fn()); await tick()
    const child = h.latest('--prompt-file')
    child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 'x'))
    expect(await turn.settled).toMatchObject({ kind: 'failed', error: expect.stringContaining('oversized') })
    const login = h.adapter.signIn(); await tick(); await h.adapter.shutdown()
    expect(await login).toMatchObject({ ok: false })
    expect(h.children.every((entry) => entry.closed)).toBe(true)
  })
})
