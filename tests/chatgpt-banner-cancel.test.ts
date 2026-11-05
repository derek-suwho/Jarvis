import { expect, it, vi } from 'vitest';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [false, vi.fn()],
}));
import { ChatGPTConnectBanner } from '../src/components/ChatGPTAccount';

it('lets users cancel browser sign-in from the start-screen banner', () => {
  const cancel = vi.fn();
  const signIn = vi.fn();
  const account = { state: { phase: 'signing-in' }, cancel, signIn } as unknown as ChatGPTAccount;
  const banner = ChatGPTConnectBanner({ account });
  function find(node: any): any {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 'button' && node.props.children === 'Cancel') return node;
    return [node.props?.children].flat(Infinity).map(find).find(Boolean);
  }
  const button = find(banner);
  expect(button, 'waiting banner offers Cancel').toBeDefined();
  button.props.onClick();
  expect(cancel).toHaveBeenCalledOnce();
  expect(signIn).not.toHaveBeenCalled();
});
