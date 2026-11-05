import { expect, it, vi } from 'vitest';
import type { ChatGPTAccount } from '../src/lib/useChatGPT';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [false, vi.fn()],
}));
import { ChatGPTConnectBanner } from '../src/components/ChatGPTAccount';

it('announces start-screen sign-in failures and removes the alert on retry', () => {
  const render = (state: ChatGPTAccount['state']) => ChatGPTConnectBanner({
    account: { state } as ChatGPTAccount,
  }) as any;
  const error = 'Sign-in timed out. Please try again.';
  const feedback = render({ phase: 'signed-out', registered: true, error }).props.children[0].props.children[1];
  expect(feedback.props.children).toBe(error);
  expect(feedback.props.role, 'sign-in failure is announced on the start screen').toBe('alert');
  const retry = render({ phase: 'signing-in' }).props.children[0].props.children[1];
  expect(retry.props.role).toBeUndefined();
  expect(retry.props.children).not.toBe(error);
});
