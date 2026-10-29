import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import inference from '../electron/chatgpt-inference.cjs';

const auth = createRequire(import.meta.url)('../electron/chatgpt-auth.cjs');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateRequest', () => {
  it('passes through user/assistant turns', () => {
    expect(
      inference.validateRequest({
        model: 'gpt-6.1-sol',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello', extra: 'dropped' },
        ],
      }),
    ).toEqual({
      model: 'gpt-6.1-sol',
      input: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
  });

  it('rejects bad models, roles and empty conversations', () => {
    expect(() => inference.validateRequest({ model: 'x y', messages: [{ role: 'user', content: 'a' }] })).toThrow();
    expect(() => inference.validateRequest({ model: 'm', messages: [{ role: 'system', content: 'a' }] })).toThrow();
    expect(() => inference.validateRequest({ model: 'm', messages: [] })).toThrow();
  });

  it('maps images and PDFs into native Responses content in attachment order', () => {
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const pdf = { name: 'report.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') };
    const result = inference.validateRequest({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Compare these', media: [image, pdf] }, { role: 'assistant', content: 'Summary' }],
    });
    expect(result.input).toEqual([
      { role: 'user', content: [
        { type: 'input_text', text: 'Compare these' },
        { type: 'input_text', text: 'Attached image: "chart.png"' },
        { type: 'input_image', image_url: `data:image/png;base64,${image.data}` },
        { type: 'input_file', filename: 'report.pdf', file_data: `data:application/pdf;base64,${pdf.data}` },
      ] },
      { role: 'assistant', content: 'Summary' },
    ]);
  });

  it('rejects malformed media at the IPC boundary', () => {
    expect(() => inference.validateRequest({ model: 'm', messages: [{ role: 'user', content: '', media: [{ name: 'fake.pdf', type: 'application/pdf', data: 'bad' }] }] })).toThrow();
  });
});

describe('media transport', () => {
  it('posts original media bytes to Responses with the existing subscription transport', async () => {
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('test-access-token');
    const fetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.output_text.delta","delta":"A chart"}\n\ndata: {"type":"response.completed"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetch);
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const payload = { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Analyze', media: [image] }] };
    const emit = vi.fn();
    await inference.streamResponse(payload, emit, new AbortController().signal, async () => []);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request.headers.Authorization).toBe('Bearer test-access-token');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'gpt-6.1-sol', stream: true, store: false,
      input: inference.validateRequest(payload).input,
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{ type: 'delta', text: 'A chart' }, { type: 'done' }]);
  });

  it('rejects invalid attachments before authorization or network requests', async () => {
    const token = vi.spyOn(auth, 'getAccessToken');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const emit = vi.fn();
    await inference.streamResponse({ model: 'm', messages: [{ role: 'user', content: 'Read', media: [{ name: 'bad.pdf', type: 'application/pdf', data: 'bad' }] }] }, emit, undefined, async () => []);
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
  });
});

describe('sseEvents', () => {
  it('parses data blocks split across chunks and skips [DONE]', async () => {
    const enc = new TextEncoder();
    async function* body() {
      yield enc.encode('event: x\ndata: {"type":"response.output_text.delta","del');
      yield enc.encode('ta":"Hi"}\n\ndata: {"type":"response.completed"}\n\ndata: [DONE]\n\n');
    }
    const events = [];
    for await (const e of inference.sseEvents(body())) events.push(e);
    expect(events).toEqual([{ type: 'response.output_text.delta', delta: 'Hi' }, { type: 'response.completed' }]);
  });
});
