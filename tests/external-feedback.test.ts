import { afterEach, expect, it, vi } from 'vitest';
import { openExternal } from '../src/lib/desktop';

afterEach(() => vi.unstubAllGlobals());

it('handles failed native browser handoffs with safe feedback and allows retry', async () => {
  const launch = vi.fn().mockRejectedValueOnce(new Error('/private/platform/detail')).mockResolvedValueOnce(undefined);
  vi.stubGlobal('window', { jarvis: { openExternal: launch } });
  const notify = vi.fn();
  await expect(openExternal('https://example.com/', notify)).resolves.toBeUndefined();
  expect(notify).toHaveBeenCalledExactlyOnceWith('Could not open in your browser. Try again.');
  notify.mockClear();
  await openExternal('https://example.com/', notify);
  expect(launch).toHaveBeenCalledTimes(2);
  expect(notify).not.toHaveBeenCalled();
});
