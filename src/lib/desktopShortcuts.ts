import type { DesktopCommand } from './desktop';

interface ShortcutActions {
  openBrowser: (fullView: boolean) => void;
  openSideChat: () => void;
  runCommand: (command: DesktopCommand) => void;
}

export function handleDesktopShortcut(e: KeyboardEvent, actions: ShortcutActions) {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.shiftKey && !e.altKey && e.code === 'KeyB') actions.openBrowser(false);
  else if (e.shiftKey && !e.altKey && e.code === 'KeyF') actions.openBrowser(true);
  else if (e.altKey && !e.shiftKey && e.code === 'KeyS') actions.openSideChat();
  else if (e.shiftKey && !e.altKey && e.code === 'KeyO') actions.runCommand('new-chat');
  else if (e.shiftKey && !e.altKey && e.code === 'KeyS') actions.runCommand('toggle-sidebar');
  else if (!e.shiftKey && !e.altKey && e.code === 'KeyK') actions.runCommand('search');
  else if (!e.shiftKey && !e.altKey && e.key === ',') actions.runCommand('settings');
  else return;
  e.preventDefault();
}
