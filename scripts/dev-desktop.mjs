// Vite reloads the renderer; CJS edits restart Electron so its adapters cannot stay stale.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import electron from 'electron';
import { createServer } from 'vite';
import { createDesktopRunner } from './desktop-runner.mjs';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Vite ready at ${url}, launching Electron`);

let watcher;
const runner = createDesktopRunner({
  spawnChild: () => spawn(electron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  }),
  closeServer: async () => {
    watcher?.close();
    await server.close();
  },
  onExit: (code, error) => {
    if (error) console.error(error);
    process.exit(code);
  },
});
watcher = watch(new URL('../electron/', import.meta.url), { recursive: true }, (_event, filename) => runner.fileChanged(filename));
watcher.on('error', (error) => {
  console.error(error);
  runner.stop(1);
});
process.once('SIGINT', () => runner.stop(130));
process.once('SIGTERM', () => runner.stop(143));
