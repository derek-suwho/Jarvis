import { afterEach, expect, it, vi } from 'vitest';
import { exportTextFile } from '../src/lib/desktop';

afterEach(() => vi.unstubAllGlobals());

it('announces a completed native export only after the save resolves', async () => {
  let complete!: (saved: boolean) => void;
  const saveFile = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  vi.stubGlobal('window', { jarvis: { saveFile } });
  const notify = vi.fn();
  const pending = exportTextFile('chat.md', '# Chat', 'text/markdown', notify);
  expect(saveFile).toHaveBeenCalledWith('chat.md', '# Chat');
  expect(notify).not.toHaveBeenCalled();
  complete(true);
  await pending;
  expect(notify).toHaveBeenCalledExactlyOnceWith('Export saved');
});

it('keeps cancellation quiet and handles failed exports with safe retry feedback', async () => {
  const saveFile = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('/private/path'))
    .mockResolvedValueOnce(true);
  vi.stubGlobal('window', { jarvis: { saveFile } });
  const notify = vi.fn();
  await exportTextFile('backup.json', '{}', 'application/json', notify);
  expect(notify).not.toHaveBeenCalled();
  await expect(exportTextFile('backup.json', '{}', 'application/json', notify)).resolves.toBeUndefined();
  expect(notify).toHaveBeenCalledExactlyOnceWith('Could not export. Try again.');
  await exportTextFile('backup.json', '{}', 'application/json', notify);
  expect(notify).toHaveBeenLastCalledWith('Export saved');
});
