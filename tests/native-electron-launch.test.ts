import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);

it('launches native Electron directly on macOS and under Xvfb only on Linux', () => {
  const { nativeElectronLaunch } = require('../scripts/native-electron-launch.cjs');
  const args = ['smoke.cjs', 'reopen', 'directory with spaces'];
  expect(nativeElectronLaunch('darwin', '/Electron App', args)).toEqual({
    command: '/Electron App', args,
  });
  expect(nativeElectronLaunch('linux', '/electron', args)).toEqual({
    command: 'xvfb-run', args: ['-a', '/electron', ...args],
  });
  expect(nativeElectronLaunch('win32', 'electron.exe', args)).toEqual({ command: 'electron.exe', args });
  expect(args).toEqual(['smoke.cjs', 'reopen', 'directory with spaces']);
});
