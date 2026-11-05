import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  dialog: { showModal: vi.fn(), close: vi.fn() },
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: () => ({ current: lifecycle.dialog }),
  useEffect: (effect: () => void | (() => void)) => { lifecycle.effects.push(effect); },
}));
import { ChatGPTWelcome } from '../src/components/ChatGPTAccount';

describe('ChatGPT welcome keyboard lifecycle', () => {
  beforeEach(() => {
    lifecycle.effects.length = 0;
    vi.clearAllMocks();
  });

  it('opens a browser modal for focus containment and closes it on cleanup', () => {
    const view = ChatGPTWelcome({ account: { showWelcome: true } as ChatGPTAccount });
    expect(view?.type).toBe('dialog');
    const cleanup = lifecycle.effects[0]();
    expect(lifecycle.dialog.showModal).toHaveBeenCalledOnce();
    expect(cleanup).toBeTypeOf('function');
    if (cleanup) cleanup();
    expect(lifecycle.dialog.close).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape through the native cancel event', () => {
    const dismissWelcome = vi.fn();
    const view = ChatGPTWelcome({ account: { showWelcome: true, dismissWelcome } as unknown as ChatGPTAccount }) as ReactElement;
    const preventDefault = vi.fn();
    expect(view.props.onCancel).toBeTypeOf('function');
    view.props.onCancel({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dismissWelcome).toHaveBeenCalledOnce();
  });

  it('does not open a modal while the disclosure is hidden', () => {
    expect(ChatGPTWelcome({ account: { showWelcome: false } as ChatGPTAccount })).toBeNull();
    lifecycle.effects.forEach((effect) => effect());
    expect(lifecycle.dialog.showModal).not.toHaveBeenCalled();
  });
});
