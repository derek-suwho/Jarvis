import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRunner } from '../scripts/desktop-runner.mjs';

class Child extends EventEmitter {
  signals: string[] = [];
  kill(signal: string) {
    this.signals.push(signal);
    return true;
  }
}

function setup() {
  const children: Child[] = [];
  const closeServer = vi.fn(async () => {});
  const onExit = vi.fn();
  const runner = createDesktopRunner({
    spawnChild: () => {
      const child = new Child();
      children.push(child);
      return child;
    },
    closeServer,
    onExit,
  });
  return { runner, children, closeServer, onExit };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('desktop development runner', () => {
  it('debounces main-process edits and waits for the old Electron process to exit before replacement', async () => {
    const { runner, children, closeServer } = setup();
    runner.fileChanged('chatgpt-inference.cjs');
    await vi.advanceTimersByTimeAsync(100);
    runner.fileChanged('tools/host.cjs');
    await vi.advanceTimersByTimeAsync(149);
    expect(children[0].signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(children).toHaveLength(1);
    children[0].emit('exit', null, 'SIGTERM');
    expect(children).toHaveLength(2);
    expect(closeServer).not.toHaveBeenCalled();
  });

  it('ignores renderer and unrelated file changes', async () => {
    const { runner, children } = setup();
    runner.fileChanged('../src/App.tsx');
    runner.fileChanged('notes.md');
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(1);
    expect(children[0].signals).toEqual([]);
  });

  it('coalesces edits while Electron shuts down without overlapping children', async () => {
    const { runner, children } = setup();
    runner.fileChanged('main.cjs');
    await vi.advanceTimersByTimeAsync(150);
    runner.fileChanged('preload.cjs');
    children[0].emit('exit', null, 'SIGTERM');
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(children).toHaveLength(2);
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(children[1].signals).toEqual([]);
  });

  it('normal user quit closes Vite and cancels pending restarts', async () => {
    const { runner, children, closeServer, onExit } = setup();
    runner.fileChanged('main.cjs');
    children[0].emit('exit', 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(1);
    expect(closeServer).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('signal shutdown is idempotent and waits for Electron before closing Vite', async () => {
    const { runner, children, closeServer, onExit } = setup();
    runner.fileChanged('main.cjs');
    runner.stop(130);
    runner.stop(143);
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(closeServer).not.toHaveBeenCalled();
    children[0].emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(closeServer).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledExactlyOnceWith(130);
    expect(children).toHaveLength(1);
  });

  it('shutdown during a pending restart cannot launch another child', async () => {
    const { runner, children, closeServer } = setup();
    runner.fileChanged('main.cjs');
    await vi.advanceTimersByTimeAsync(150);
    runner.stop();
    children[0].emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(children).toHaveLength(1);
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(closeServer).toHaveBeenCalledOnce();
  });

  it('spawn failures close the server instead of leaving a headless dev process', async () => {
    const closeServer = vi.fn(async () => {});
    const onExit = vi.fn();
    createDesktopRunner({ spawnChild: () => { throw new Error('Missing Electron'); }, closeServer, onExit });
    await vi.advanceTimersByTimeAsync(0);
    expect(closeServer).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'Missing Electron' }));
  });

  it('handles emitted spawn errors once, even if an exit event follows', async () => {
    const { children, closeServer, onExit } = setup();
    children[0].emit('error', new Error('spawn ENOENT'));
    children[0].emit('exit', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(closeServer).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'spawn ENOENT' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('escalates a stuck shutdown without spawning before exit', async () => {
    const { runner, children } = setup();
    runner.fileChanged('main.cjs');
    await vi.advanceTimersByTimeAsync(3150);
    expect(children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(children).toHaveLength(1);
    children[0].emit('exit', null, 'SIGKILL');
    expect(children).toHaveLength(2);
  });
});
