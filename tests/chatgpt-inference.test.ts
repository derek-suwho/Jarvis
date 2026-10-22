import { describe, expect, it } from 'vitest';
import inference from '../electron/chatgpt-inference.cjs';

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
