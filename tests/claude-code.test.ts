import { describe, expect, it } from 'vitest';
import claude from '../electron/claude-code.cjs';

const req = (messages: { role: string; content: string }[], extra: object = {}) =>
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
});

const args = (b: { args: string[] }) => b.args;
