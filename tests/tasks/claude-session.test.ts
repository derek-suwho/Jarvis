import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';

const nativeRequire = createRequire(import.meta.url);
const request = {
  model: 'claude-sonnet-5-5', mode: 'chat', reasoning: 'High', conversationId: 'task-chat',
  messages: [{ role: 'user', content: 'Original objective' }],
};
const flag = (args: string[], name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(config: { tools?: Promise<unknown>; lookup?: Promise<string> } = {}) {
  const children: any[] = [];
  const spawn = vi.fn((_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => true),
      args,
    });
    children.push(child);
    return child;
  });
  const module = { exports: {} as any };
  runInNewContext(readFileSync(new URL('../../electron/claude-code.cjs', import.meta.url), 'utf8'), {
    module, process, AbortController, Buffer, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === 'electron') return { app: { getPath: () => '/test/jarvis' } };
      if (name === 'node:timers') return { setTimeout, clearTimeout };
      if (name === 'node:child_process') return {
        spawn,
        execFile: (_bin: string, _args: string[], _options: object, cb: Function) => {
          void config.lookup?.then((binary) => cb(null, binary));
        },
      };
      if (name === 'node:fs') return { existsSync: () => !config.lookup, mkdirSync: vi.fn() };
      if (name === './tools/index.cjs') return {
        claudeMcpConfigFile: () => config.tools ?? Promise.resolve(null),
        labelTool: (name: string) => ({ server: 'Example', tool: name }),
      };
      if (name === './rendering-guide.cjs') return { RENDERING_GUIDE: '' };
      if (name === './media-input.cjs') return nativeRequire('../../electron/media-input.cjs');
      return nativeRequire(name);
    },
  });
  const events: any[] = [];
  const open = (continuation?: unknown, updates: any[] = []) => module.exports.openAttempt({
    request, continuation, updates, attemptId: `attempt-${children.length}`,
  }, (event: unknown) => events.push(event));
  const line = (child: any, event: object) => child.stdout.emit('data', `${JSON.stringify(event)}\n`);
  const session = (child: any) => flag(child.args, '--session-id') || flag(child.args, '--resume');
  const finish = (child: any, extra: object = {}) => {
    line(child, { type: 'result', subtype: 'success', result: 'Finished', session_id: session(child), ...extra });
    child.emit('close', 0, null);
  };
  return { open, children, spawn, events, line, session, finish };
}

afterEach(() => vi.useRealTimers());

describe('Claude task sessions', () => {
  it('waits for SIGINT acknowledgement and process exit, then resumes the exact session once', async () => {
    const h = harness();
    const first = h.open();
    await tick();
    const child = h.children[0];
    h.line(child, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial work' } } });
    first.interrupt();
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
    let settled = false;
    void first.settled.then(() => { settled = true; });
    h.line(child, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Interrupted by user', session_id: h.session(child) });
    await tick();
    expect(settled).toBe(false);
    child.emit('close', 130, null);
    const result = await first.settled;
    expect(result.kind).toBe('interrupted');
    expect(h.events).toEqual([{ type: 'delta', text: 'Partial work' }]);
    const resumed = h.open(result.continuation, [{ role: 'user', content: 'New direction' }]);
    await tick();
    const next = h.children[1];
    expect(flag(next.args, '--resume')).toBe(h.session(child));
    expect(next.args).not.toContain('--session-id');
    expect(next.stdin.end.mock.calls[0][0]).toBe('New direction');
    expect(next.stdin.end.mock.calls[0][0]).not.toContain('Original objective');
    h.finish(next);
    expect((await resumed.settled).kind).toBe('complete');
  });

  it('sends queued text and image/PDF media in order without replaying original input', async () => {
    const h = harness();
    const first = h.open();
    await tick();
    h.finish(h.children[0]);
    const initial = await first.settled;
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const pdf = { name: 'report.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') };
    const next = h.open(initial.continuation, [
      { role: 'user', content: 'First direction', media: [image] },
      { role: 'user', content: 'Second direction', media: [pdf] },
    ]);
    await tick();
    const child = h.children[1];
    expect(flag(child.args, '--input-format')).toBe('stream-json');
    const prompt = child.stdin.end.mock.calls[0][0];
    expect(prompt).not.toContain('Original objective');
    expect(prompt.indexOf('First direction')).toBeLessThan(prompt.indexOf('Second direction'));
    const blocks = JSON.parse(prompt).message.content;
    expect(blocks.filter((block: any) => block.type === 'image')).toHaveLength(1);
    expect(blocks.filter((block: any) => block.type === 'document')).toHaveLength(1);
    h.finish(child);
    expect((await next.settled).kind).toBe('complete');
  });

  it('never spawns when stopped during binary discovery or tool setup', async () => {
    let releaseLookup!: (value: string) => void;
    const lookup = harness({ lookup: new Promise((resolve) => { releaseLookup = resolve; }) });
    const beforeLookup = lookup.open();
    beforeLookup.stop();
    releaseLookup('/fake/claude');
    expect((await beforeLookup.settled).kind).toBe('failed');
    expect(lookup.spawn).not.toHaveBeenCalled();

    let releaseTools!: (value: unknown) => void;
    const setup = harness({ tools: new Promise((resolve) => { releaseTools = resolve; }) });
    const beforeTools = setup.open();
    await tick();
    beforeTools.stop();
    releaseTools(null);
    expect((await beforeTools.settled).kind).toBe('failed');
    expect(setup.spawn).not.toHaveBeenCalled();
  });

  it('interrupts before spawn without a session and preserves original input for the first real attempt', async () => {
    let release!: (value: unknown) => void;
    const h = harness({ tools: new Promise((resolve) => { release = resolve; }) });
    const first = h.open();
    await tick();
    first.interrupt();
    const interrupted = await first.settled;
    expect(interrupted).toMatchObject({ kind: 'interrupted', continuation: { pending: true } });
    release(null);
    await tick();
    expect(h.spawn).not.toHaveBeenCalled();
    const next = h.open(interrupted.continuation, [{ role: 'user', content: 'New direction' }]);
    await tick();
    const child = h.children[0];
    expect(child.args).not.toContain('--resume');
    expect(child.stdin.end.mock.calls[0][0]).toContain('Original objective');
    expect(child.stdin.end.mock.calls[0][0]).toContain('New direction');
    h.finish(child);
    expect((await next.settled).kind).toBe('complete');
  });

  it.each(['missing-result', 'missing-session', 'wrong-session'])('refuses unsafe continuation for %s', async (failure) => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    attempt.interrupt();
    if (failure !== 'missing-result') h.line(child, {
      type: 'result', subtype: 'success',
      ...(failure === 'wrong-session' ? { session_id: 'different-session' } : {}),
    });
    child.emit('close', 0, null);
    const result = await attempt.settled;
    expect(result.kind).toBe('failed');
    expect(result.continuation).toBeUndefined();
    expect(result.error).toMatch(/interruption|session/i);
    expect(h.children).toHaveLength(1);
  });

  it('times out an unacknowledged interruption without resolving before the child exits', async () => {
    vi.useFakeTimers();
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    attempt.interrupt();
    let settled = false;
    void attempt.settled.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(settled).toBe(false);
    child.emit('close', 143, 'SIGTERM');
    const result = await attempt.settled;
    expect(result).toMatchObject({ kind: 'failed', uncertainEffects: true });
    expect(result.error).toMatch(/did not acknowledge/i);
    expect(result.continuation).toBeUndefined();
  });

  it('retains unknown tool effects even when the CLI acknowledges interruption', async () => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    attempt.interrupt();
    // The child dispatched the tool before SIGINT, but its output arrived afterward.
    h.line(child, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'write-1', name: 'write' }] } });
    h.finish(child);
    const result = await attempt.settled;
    expect(result).toMatchObject({ kind: 'failed', uncertainEffects: true });
    expect(result.continuation).toBeUndefined();
    expect(result.error).toMatch(/outcome/i);
  });

  it('stop overrides pending interruption and cannot yield a continuation', async () => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    attempt.interrupt();
    attempt.stop();
    expect(child.kill.mock.calls.map(([signal]: string[]) => signal)).toEqual(['SIGINT', 'SIGTERM']);
    h.finish(child);
    expect(await attempt.settled).toMatchObject({ kind: 'failed', error: 'Stopped.' });
  });

  it('reports broken stdin and cleans up owned listeners after process close', async () => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    child.stdin.emit('error', new Error('write EPIPE'));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1, null);
    const result = await attempt.settled;
    expect(result.kind).toBe('failed');
    expect(result.error).toContain('write EPIPE');
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
  });

  it('handles malformed lines and result without a trailing newline', async () => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    child.stdout.emit('data', 'not-json\nnull\n12\n');
    child.stdout.emit('data', JSON.stringify({ type: 'result', subtype: 'success', result: 'Complete output', session_id: h.session(child) }));
    child.emit('close', 0, null);
    expect((await attempt.settled).kind).toBe('complete');
    expect(h.events).toEqual([{ type: 'delta', text: 'Complete output' }]);
  });

  it('does not resume after a crashed child even when an earlier result looked successful', async () => {
    const h = harness();
    const attempt = h.open();
    await tick();
    const child = h.children[0];
    attempt.interrupt();
    h.line(child, { type: 'result', subtype: 'success', session_id: h.session(child) });
    child.emit('close', null, 'SIGSEGV');
    const result = await attempt.settled;
    expect(result.kind).toBe('failed');
    expect(result.continuation).toBeUndefined();
  });
});
