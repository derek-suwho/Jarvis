import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import claude from '../electron/claude-code.cjs';

const req = (messages: { role: string; content: string; media?: { name: string; type: string; data: string }[] }[], extra: object = {}) =>
  claude.validateRequest({
    model: 'claude-sonnet-5-5',
    mode: 'chat',
    reasoning: 'High',
    conversationId: 'conv-1',
    messages,
    ...extra,
  });

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('validateRequest', () => {
  it('maps reasoning to Claude Code effort and keeps only role/content', () => {
    const r = req([{ role: 'user', content: 'hi', extra: 1 } as never]);
    expect(r.effort).toBe('high');
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('rejects bad modes, ids, and conversations not ending with the user', () => {
    expect(() => req([{ role: 'user', content: 'a' }], { mode: 'root' })).toThrow();
    expect(() => req([{ role: 'user', content: 'a' }], { conversationId: '../x' })).toThrow();
    expect(() => req([{ role: 'user', content: 'a' }], { model: 'a b' })).toThrow();
    expect(() => req([{ role: 'assistant', content: 'a' }])).toThrow();
    expect(() => req([{ role: 'user', content: 'a', media: [{ name: 'bad.pdf', type: 'application/pdf', data: 'bad' }] }])).toThrow();
  });
});

describe('buildArgs', () => {
  it('chat mode swaps the system prompt, disables tools, and skips user settings', () => {
    const { args } = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { conversationId: 'chat-mode' }));
    expect(flag(args, '--system-prompt')).toBe(claude.CHAT_SYSTEM_PROMPT);
    expect(flag(args, '--tools')).toBe('');
    expect(flag(args, '--setting-sources')).toBe('');
    expect(flag(args, '--model')).toBe('claude-sonnet-5-5');
    expect(flag(args, '--effort')).toBe('high');
  });

  it('code mode keeps Claude Code defaults', () => {
    const { args } = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { mode: 'code', conversationId: 'code-mode' }));
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--tools');
  });

  it('tells Claude what Jarvis renders in both modes', () => {
    const { args: chat } = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { conversationId: 'guide-chat' }));
    expect(flag(chat, '--system-prompt')).toContain('```mermaid');
    const { args: code } = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { mode: 'code', conversationId: 'guide-code' }));
    expect(flag(code, '--append-system-prompt')).toContain('KaTeX');
  });

  it('passes Jarvis tools through an MCP config file, strict only in chat mode', () => {
    const mcp = { file: '/tmp/claude-mcp.json', names: ['github', 'skills'] };
    const chat = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { conversationId: 'mcp-chat' }), mcp).args;
    expect(flag(chat, '--mcp-config')).toBe(mcp.file);
    expect(flag(chat, '--allowedTools')).toBe('mcp__github,mcp__skills');
    expect(chat).toContain('--strict-mcp-config');
    const code = claude.buildArgs(req([{ role: 'user', content: 'hi' }], { mode: 'code', conversationId: 'mcp-code' }), mcp).args;
    expect(flag(code, '--mcp-config')).toBe(mcp.file);
    expect(code).not.toContain('--strict-mcp-config');
  });

  it('resumes a session only when the earlier history matches exactly', () => {
    const first = req([{ role: 'user', content: 'plan a trip' }], { conversationId: 'resume' });
    const a = claude.buildArgs(first);
    expect(args(a)).toContain('--session-id');
    claude.recordSession(first, a.sessionId, 'Where to?');

    const next = req(
      [
        { role: 'user', content: 'plan a trip' },
        { role: 'assistant', content: 'Where to?' },
        { role: 'user', content: 'Lisbon' },
      ],
      { conversationId: 'resume' },
    );
    const b = claude.buildArgs(next);
    expect(flag(b.args, '--resume')).toBe(a.sessionId);
    expect(b.prompt).toBe('Lisbon');

    // An edited earlier reply no longer matches the session: start fresh from a transcript.
    const edited = req(
      [
        { role: 'user', content: 'plan a trip' },
        { role: 'assistant', content: 'Somewhere else' },
        { role: 'user', content: 'Lisbon' },
      ],
      { conversationId: 'resume' },
    );
    const c = claude.buildArgs(edited);
    expect(c.args).toContain('--session-id');
    expect(c.prompt).toContain('<conversation_so_far>');
    expect(c.prompt).toContain('Somewhere else');
  });

  it('sends native image/document blocks in a newline-delimited stream-json user event', () => {
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const pdf = { name: 'report.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') };
    const result = claude.buildArgs(req([{ role: 'user', content: 'Analyze', media: [image, pdf] }], { conversationId: 'media-first' }));
    expect(flag(result.args, '--input-format')).toBe('stream-json');
    expect(result.prompt.endsWith('\n')).toBe(true);
    expect(JSON.parse(result.prompt)).toEqual({
      type: 'user', parent_tool_use_id: null,
      message: { role: 'user', content: [
        { type: 'text', text: 'Analyze' },
        { type: 'text', text: 'Attached image: "chart.png"' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } },
        { type: 'document', title: 'report.pdf', source: { type: 'base64', media_type: 'application/pdf', data: pdf.data } },
      ] },
    });
  });

  it('preserves historical media on fresh sessions and invalidates resume when bytes change', () => {
    const image = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const firstMessage = { role: 'user', content: 'Analyze chart', media: [image] };
    const first = req([firstMessage], { conversationId: 'media-resume' });
    const started = claude.buildArgs(first);
    claude.recordSession(first, started.sessionId, 'A chart');
    const history = [firstMessage, { role: 'assistant', content: 'A chart' }, { role: 'user', content: 'Explain' }];
    const resumed = claude.buildArgs(req(history, { conversationId: 'media-resume' }));
    expect(flag(resumed.args, '--resume')).toBe(started.sessionId);
    expect(resumed.args).not.toContain('--input-format');
    expect(resumed.prompt).toBe('Explain');

    const changedImage = { ...image, data: Buffer.from('89504e470d0a1a0a00', 'hex').toString('base64') };
    const fresh = claude.buildArgs(req([{ ...firstMessage, media: [changedImage] }, ...history.slice(1)], { conversationId: 'media-resume' }));
    expect(fresh.args).not.toContain('--resume');
    expect(flag(fresh.args, '--input-format')).toBe('stream-json');
    const blocks = JSON.parse(fresh.prompt).message.content;
    expect(blocks).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: changedImage.data } });
    const text = blocks.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('\n');
    expect(text).toContain('<conversation_so_far>');
    expect(text).toContain('<assistant>');
    expect(text).toContain('A chart');
    expect(text).toContain('Explain');
    expect(fresh.prompt).not.toContain('[object Object]');

    const withNewImage = claude.buildArgs(req([
      ...history.slice(0, -1), { role: 'user', content: 'Compare', media: [changedImage] },
    ], { conversationId: 'media-resume' }));
    expect(flag(withNewImage.args, '--resume')).toBe(started.sessionId);
    const resumedBlocks = JSON.parse(withNewImage.prompt).message.content;
    expect(resumedBlocks.filter((block: { type: string }) => block.type === 'image')).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: changedImage.data } },
    ]);
  });
});

const args = (b: { args: string[] }) => b.args;

describe('Claude media stdin transport', () => {
  async function runTransport(pipeError = false) {
    const child = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    child.stdin.end.mockImplementation(() => {
      queueMicrotask(() => {
        if (pipeError) child.stdin.emit('error', new Error('write EPIPE'));
        else child.stdout.emit('data', JSON.stringify({ type: 'result', subtype: 'success', result: 'A chart' }) + '\n');
        child.emit('close', pipeError ? 1 : 0);
      });
    });
    const spawn = vi.fn((_bin: string, _args: string[], _options: object) => child);
    const nativeRequire = createRequire(import.meta.url);
    const module = { exports: {} as typeof claude };
    runInNewContext(readFileSync(new URL('../electron/claude-code.cjs', import.meta.url), 'utf8'), {
      module, process, AbortController,
      require: (name: string) => {
        if (name === 'electron') return { app: { getPath: () => '/test/jarvis' } };
        if (name === 'node:child_process') return { spawn, execFile: vi.fn() };
        if (name === 'node:fs') return { existsSync: () => true, mkdirSync: vi.fn() };
        if (name === './tools/index.cjs') return { claudeMcpConfigFile: async () => null };
        if (name === './rendering-guide.cjs') return { RENDERING_GUIDE: '' };
        if (name === './media-input.cjs') return nativeRequire('../electron/media-input.cjs');
        return nativeRequire(name);
      },
    });
    const handlers = new Map<string, (...args: any[]) => void>();
    module.exports.registerIpc({ handle: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler) });
    const media = { name: 'chart.png', type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
    const events: any[] = [];
    await new Promise<void>((resolve) => {
      handlers.get('claude:stream')!({ sender: {
        isDestroyed: () => false,
        send: (_channel: string, _id: string, event: object) => { events.push(event); resolve(); },
      } }, 'media-request', {
        model: 'claude-sonnet-5-5', mode: 'chat', reasoning: 'High', conversationId: 'transport',
        messages: [{ role: 'user', content: 'Analyze', media: [media] }],
      });
    });
    return { child, spawn, events, media };
  }

  it('writes native blocks to the spawned CLI stdin', async () => {
    const { child, spawn, events, media } = await runTransport();
    expect(spawn).toHaveBeenCalledOnce();
    expect(flag(spawn.mock.calls[0][1], '--input-format')).toBe('stream-json');
    expect(child.stdin.end).toHaveBeenCalledOnce();
    const event = JSON.parse(child.stdin.end.mock.calls[0][0]);
    expect(event.message.content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: media.type, data: media.data } });
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('reports a closed stdin pipe without an unhandled process error', async () => {
    const { events } = await runTransport(true);
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: expect.stringContaining('write EPIPE') })]);
  });
});
