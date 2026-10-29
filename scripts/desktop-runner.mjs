/**
 * Keeps one Electron child alive during main-process development. Renderer updates belong to Vite.
 * @param {{
 *   spawnChild: () => import('node:events').EventEmitter & { kill(signal: NodeJS.Signals): boolean },
 *   closeServer: () => Promise<void>,
 *   onExit: (code: number, error?: unknown) => void,
 * }} options
 */
export function createDesktopRunner({ spawnChild, closeServer, onExit }) {
  let child = null;
  let restartTimer = null;
  let forceTimer = null;
  let restarting = false;
  let terminating = false;
  let stopping = false;
  let cleanupStarted = false;
  let exitCode = 0;

  function finish(error) {
    if (cleanupStarted) return;
    cleanupStarted = true;
    stopping = true;
    clearTimeout(restartTimer);
    clearTimeout(forceTimer);
    Promise.resolve().then(closeServer).then(
      () => error ? onExit(exitCode, error) : onExit(exitCode),
      (closeError) => onExit(1, closeError),
    );
  }

  function terminate() {
    if (!child || terminating) return;
    terminating = true;
    const previous = child;
    forceTimer = setTimeout(() => {
      if (child === previous) previous.kill('SIGKILL');
    }, 3000);
    previous.kill('SIGTERM');
  }

  function launch() {
    if (stopping || child) return;
    restarting = false;
    terminating = false;
    try {
      child = spawnChild();
    } catch (error) {
      exitCode = 1;
      finish(error);
      return;
    }
    const current = child;
    let ended = false;
    const exited = (code, error) => {
      if (ended) return;
      ended = true;
      child = null;
      terminating = false;
      clearTimeout(forceTimer);
      if (error) {
        exitCode = 1;
        finish(error);
      } else if (stopping) {
        finish();
      } else if (restarting) {
        // A newer file event may still be settling; its debounce will launch the replacement.
        if (!restartTimer) launch();
      } else {
        exitCode = code ?? 0;
        finish();
      }
    };
    current.once('error', (error) => exited(1, error));
    current.once('exit', (code) => exited(code));
  }

  function fileChanged(filename) {
    if (stopping || (filename && !filename.toString().endsWith('.cjs'))) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (stopping) return;
      if (!child) {
        launch();
      } else {
        restarting = true;
        terminate();
      }
    }, 150);
  }

  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (child) terminate();
    else finish();
  }

  launch();
  return { fileChanged, stop };
}
