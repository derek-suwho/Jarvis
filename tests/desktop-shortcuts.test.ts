import { expect, it, vi } from 'vitest';
import { handleDesktopShortcut } from '../src/lib/desktopShortcuts';

const shortcuts = [
  { code: 'KeyB', shiftKey: true, action: 'openBrowser', argument: false },
  { code: 'KeyF', shiftKey: true, action: 'openBrowser', argument: true },
  { code: 'KeyS', altKey: true, action: 'openSideChat' },
  { code: 'KeyO', shiftKey: true, action: 'runCommand', argument: 'new-chat' },
  { code: 'KeyS', shiftKey: true, action: 'runCommand', argument: 'toggle-sidebar' },
  { code: 'KeyK', action: 'runCommand', argument: 'search' },
  { key: ',', action: 'runCommand', argument: 'settings' },
];

it.each(shortcuts)('preserves ordinary shortcut dispatch for $action/$code/$key', (shortcut) => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const actions = { openBrowser: vi.fn(), openSideChat: vi.fn(), runCommand: vi.fn() };
    const event = { ...shortcut, [modifier]: true, preventDefault: vi.fn() };
    handleDesktopShortcut(event as unknown as KeyboardEvent, actions);
    const action = actions[shortcut.action as keyof typeof actions];
    if ('argument' in shortcut) expect(action).toHaveBeenCalledExactlyOnceWith(shortcut.argument);
    else expect(action).toHaveBeenCalledExactlyOnceWith();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
});

it.each([
  { defaultPrevented: true },
  { isComposing: true },
  { keyCode: 229 },
])('does not navigate or consume text-input events: %j', (boundary) => {
  const actions = { openBrowser: vi.fn(), openSideChat: vi.fn(), runCommand: vi.fn() };
  for (const shortcut of shortcuts) {
    const event = { ...shortcut, metaKey: true, ...boundary, preventDefault: vi.fn() };
    handleDesktopShortcut(event as unknown as KeyboardEvent, actions);
    expect(actions.openBrowser).not.toHaveBeenCalled();
    expect(actions.openSideChat).not.toHaveBeenCalled();
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
});

it('dispatches desktop shortcuts once per key press when a key is held', () => {
  for (const shortcut of shortcuts) {
    const actions = { openBrowser: vi.fn(), openSideChat: vi.fn(), runCommand: vi.fn() };
    const press = { ...shortcut, metaKey: true, repeat: false, preventDefault: vi.fn() };
    handleDesktopShortcut(press as unknown as KeyboardEvent, actions);
    for (let repeat = 0; repeat < 3; repeat++) {
      handleDesktopShortcut({ ...press, repeat: true } as unknown as KeyboardEvent, actions);
    }
    expect(actions[shortcut.action as keyof typeof actions]).toHaveBeenCalledOnce();
  }
});
