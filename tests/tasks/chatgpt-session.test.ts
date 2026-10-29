import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import inference from '../../electron/chatgpt-inference.cjs';

const require = createRequire(import.meta.url);
const auth = require('../../electron/chatgpt-auth.cjs');
const tools = require('../../electron/tools/index.cjs');
const request = { model: 'test-model', messages: [{ role: 'user', content: 'Research the original task.' }] };
const encoder = new TextEncoder();

function response(events: object[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function toolCall(id: string, name: string) {
  return { type: 'response.output_item.done', item: { type: 'function_call', call_id: id, name, arguments: '{}' } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function streamingFetch() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    options.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    push: (event: object) => stream.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
  };
}

beforeEach(() => {
  vi.spyOn(auth, 'getAccessToken').mockResolvedValue('fixture-token');
  vi.spyOn(tools, 'catalog').mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChatGPT task attempts', () => {
  it('applies waiting updates and media exactly once without changing the original context', async () => {
    const fetch = vi.fn().mockResolvedValue(response([
      { type: 'response.output_text.delta', delta: 'Result' }, { type: 'response.completed' },
    ]));
    vi.stubGlobal('fetch', fetch);
    const emit = vi.fn();
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const attempt = inference.openAttempt({ request, updates: [{ role: 'user', content: 'Include this chart.', media: [image] }], attemptId: 'first' }, emit);
    const result = await attempt.settled;
    expect(result.kind).toBe('complete');
    expect(JSON.parse(fetch.mock.calls[0][1].body).input).toEqual([
      { role: 'user', content: 'Research the original task.' },
      { role: 'user', content: [
        { type: 'input_text', text: 'Include this chart.' },
        { type: 'input_text', text: 'Attached image: "chart.png"' },
        { type: 'input_image', image_url: `data:image/png;base64,${image.data}` },
      ] },
    ]);
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{ type: 'delta', text: 'Result' }]);
    expect(request.messages).toEqual([{ role: 'user', content: 'Research the original task.' }]);
  });

  it('interrupts HTTP, labels partial text and resumes with new instructions once', async () => {
    const transport = streamingFetch();
    const emit = vi.fn();
    const first = inference.openAttempt({ request, updates: [], attemptId: 'first' }, emit);
    await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
    transport.push({ type: 'response.output_text.delta', delta: 'Partial finding' });
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'delta', text: 'Partial finding' }));
    expect(transport.fetch.mock.calls[0][1].signal?.aborted).toBe(false);
    first.interrupt();
    const interrupted = await first.settled;
    expect(interrupted.kind).toBe('interrupted');
    expect(transport.fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(emit.mock.calls.every(([event]) => event.type === 'delta')).toBe(true);

    transport.fetch.mockResolvedValueOnce(response([{ type: 'response.output_text.delta', delta: 'Updated result' }, { type: 'response.completed' }]));
    const next = inference.openAttempt({ request, continuation: interrupted.continuation, updates: [{ role: 'user', content: 'Focus on costs.' }], attemptId: 'second' }, vi.fn());
    expect((await next.settled).kind).toBe('complete');
    const input = JSON.parse(transport.fetch.mock.calls[1][1].body as string).input;
    expect(input).toHaveLength(3);
    expect(input[0]).toEqual({ role: 'user', content: 'Research the original task.' });
    expect(input[1]).toMatchObject({ role: 'assistant', content: expect.stringMatching(/interrupted[\s\S]*Partial finding/i) });
    expect(input[2]).toEqual({ role: 'user', content: 'Focus on costs.' });
  });

  it('waits for an active tool, cancels unstarted calls and never replays completed effects', async () => {
    const outcome = deferred<string>();
    let firstCalls = 0;
    let secondCalls = 0;
    vi.mocked(tools.catalog).mockResolvedValue([
      { name: 'write_one', server: 'Files', tool: 'write_one', run: () => { firstCalls++; return outcome.promise; } },
      { name: 'write_two', server: 'Files', tool: 'write_two', run: () => { secondCalls++; return 'written two'; } },
    ]);
    const fetch = vi.fn().mockResolvedValueOnce(response([toolCall('one', 'write_one'), toolCall('two', 'write_two'), { type: 'response.completed' }]))
      .mockResolvedValueOnce(response([{ type: 'response.output_text.delta', delta: 'Adjusted' }, { type: 'response.completed' }]));
    vi.stubGlobal('fetch', fetch);
    const first = inference.openAttempt({ request, updates: [], attemptId: 'first' }, vi.fn());
    await vi.waitFor(() => expect(firstCalls).toBe(1));
    first.interrupt();
    let settled = false;
    void first.settled.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(secondCalls).toBe(0);
    outcome.resolve('written one');
    const interrupted = await first.settled;
    expect(interrupted.kind).toBe('interrupted');
    expect(secondCalls).toBe(0);
    const second = inference.openAttempt({ request, continuation: interrupted.continuation, updates: [{ role: 'user', content: 'Stop writing; summarize.' }], attemptId: 'second' }, vi.fn());
    expect((await second.settled).kind).toBe('complete');
    const input = JSON.parse(fetch.mock.calls[1][1].body).input;
    expect(input.filter((item: any) => item.type === 'function_call_output')).toEqual([
      { type: 'function_call_output', call_id: 'one', output: 'written one' },
      { type: 'function_call_output', call_id: 'two', output: expect.stringMatching(/not executed/i) },
    ]);
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(0);
  });

  it('retains completed reply and completed tool pairs for natural queue continuation', async () => {
    let calls = 0;
    vi.mocked(tools.catalog).mockResolvedValue([{ name: 'lookup', run: async () => { calls++; return 'found'; } }]);
    const fetch = vi.fn().mockResolvedValueOnce(response([toolCall('lookup-1', 'lookup'), { type: 'response.completed' }]))
      .mockResolvedValueOnce(response([{ type: 'response.output_text.delta', delta: 'First answer' }, { type: 'response.completed' }]))
      .mockResolvedValueOnce(response([{ type: 'response.output_text.delta', delta: 'Second answer' }, { type: 'response.completed' }]));
    vi.stubGlobal('fetch', fetch);
    const first = await inference.openAttempt({ request, updates: [], attemptId: 'first' }, vi.fn()).settled;
    const second = await inference.openAttempt({ request, continuation: first.continuation, updates: [{ role: 'user', content: 'Explain more.' }], attemptId: 'second' }, vi.fn()).settled;
    expect(second.kind).toBe('complete');
    const input = JSON.parse(fetch.mock.calls[2][1].body).input;
    expect(input.slice(-2)).toEqual([{ role: 'assistant', content: 'First answer' }, { role: 'user', content: 'Explain more.' }]);
    expect(input.filter((item: any) => item.type === 'function_call_output')).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('reports uncertain tool outcomes and dispatches no remaining calls', async () => {
    let untouchedCalls = 0;
    vi.mocked(tools.catalog).mockResolvedValue([
      { name: 'write', run: async () => { throw new Error('Connection lost after request'); } },
      { name: 'untouched', run: async () => { untouchedCalls++; return 'wrong'; } },
    ]);
    const fetch = vi.fn().mockResolvedValue(response([toolCall('write-1', 'write'), toolCall('write-2', 'untouched'), { type: 'response.completed' }]));
    vi.stubGlobal('fetch', fetch);
    const result = await inference.openAttempt({ request, updates: [], attemptId: 'one' }, vi.fn()).settled;
    expect(result).toMatchObject({ kind: 'failed', uncertainEffects: true, error: expect.stringMatching(/outcome|unknown|confirm/i) });
    expect(untouchedCalls).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not submit a stopped attempt after asynchronous tool setup finishes', async () => {
    const catalog = deferred<any[]>();
    vi.mocked(tools.catalog).mockReturnValue(catalog.promise);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const first = inference.openAttempt({ request, updates: [], attemptId: 'one' }, vi.fn());
    first.stop();
    catalog.resolve([]);
    expect((await first.settled).kind).toBe('interrupted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch more tools or a new request when stopped during a tool', async () => {
    const tool = deferred<string>();
    let started = 0;
    vi.mocked(tools.catalog).mockResolvedValue([{ name: 'write', run: () => { started++; return tool.promise; } }]);
    const fetch = vi.fn().mockResolvedValue(response([toolCall('one', 'write'), toolCall('two', 'write'), { type: 'response.completed' }]));
    vi.stubGlobal('fetch', fetch);
    const first = inference.openAttempt({ request, updates: [], attemptId: 'one' }, vi.fn());
    await vi.waitFor(() => expect(started).toBe(1));
    first.stop();
    tool.resolve('done');
    expect((await first.settled).kind).toBe('interrupted');
    expect(started).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('checks interruption immediately before tool dispatch, including activity callbacks', async () => {
    let calls = 0;
    vi.mocked(tools.catalog).mockResolvedValue([{ name: 'write', run: async () => { calls++; return 'written'; } }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([toolCall('one', 'write'), { type: 'response.completed' }])));
    const attempt = inference.openAttempt({ request, updates: [], attemptId: 'one' }, (event: any) => {
      if (event.type === 'tool' && event.status === 'running') attempt.interrupt();
    });
    const result = await attempt.settled;
    expect(result.kind).toBe('interrupted');
    expect(calls).toBe(0);
    expect(result.continuation?.input.at(-1)).toMatchObject({ type: 'function_call_output', output: expect.stringMatching(/not executed/i) });
  });

  it('does not dispatch HTTP after interruption during credential lookup', async () => {
    const token = deferred<string>();
    vi.mocked(auth.getAccessToken).mockReturnValue(token.promise);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const attempt = inference.openAttempt({ request, updates: [], attemptId: 'one' }, vi.fn());
    await vi.waitFor(() => expect(auth.getAccessToken).toHaveBeenCalledOnce());
    attempt.interrupt();
    token.resolve('fixture-token');
    expect((await attempt.settled).kind).toBe('interrupted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves emitted text when later streamed output exceeds the cumulative limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      { type: 'response.output_text.delta', delta: 'Keep this partial.' },
      { type: 'response.output_text.delta', delta: 'x'.repeat(4 * 1024 * 1024) },
      { type: 'response.completed' },
    ])));
    const emit = vi.fn();
    const result = await inference.openAttempt({ request, updates: [], attemptId: 'one' }, emit).settled;
    expect(result).toMatchObject({ kind: 'failed', error: expect.stringMatching(/limit/i) });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{ type: 'delta', text: 'Keep this partial.' }]);
  });

  it('fails truncated streams without claiming ordinary completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ type: 'response.output_text.delta', delta: 'Partial' }])));
    const emit = vi.fn();
    const result = await inference.openAttempt({ request, updates: [], attemptId: 'one' }, emit).settled;
    expect(result).toMatchObject({ kind: 'failed', error: expect.stringMatching(/before.*finished/i) });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{ type: 'delta', text: 'Partial' }]);
  });

  it('validates aggregate queued media before authorization or network calls', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await inference.openAttempt({ request, updates: [{ role: 'user', content: 'bad', media: [{ name: 'bad.png', type: 'image/png', data: 'bad' }] }], attemptId: 'one' }, vi.fn()).settled;
    expect(result.kind).toBe('failed');
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails before a second request if accumulated tool results exceed the output limit', async () => {
    vi.mocked(tools.catalog).mockResolvedValue([{ name: 'huge', run: async () => 'x'.repeat(4 * 1024 * 1024) }]);
    const fetch = vi.fn().mockResolvedValue(response([toolCall('large', 'huge'), { type: 'response.completed' }]));
    vi.stubGlobal('fetch', fetch);
    const result = await inference.openAttempt({ request, updates: [], attemptId: 'one' }, vi.fn()).settled;
    expect(result).toMatchObject({ kind: 'failed', error: expect.stringMatching(/limit|large/i) });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
