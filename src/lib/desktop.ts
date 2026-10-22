/** Bridge exposed by electron/preload.cjs; absent when running in a normal browser. */
interface JarvisBridge {
  isDesktop: true;
  platform: string;
  openExternal: (url: string) => Promise<void>;
  /** Native save dialog; resolves false when the user cancels. */
  saveFile: (name: string, content: string) => Promise<boolean>;
  setTheme: (theme: 'system' | 'dark' | 'light') => void;
  /** Subscribes to native menu commands; returns an unsubscribe function. */
  onCommand: (cb: (command: DesktopCommand) => void) => () => void;
}

export type DesktopCommand = 'new-chat' | 'search' | 'settings' | 'toggle-sidebar';

declare global {
  interface Window {
    jarvis?: JarvisBridge;
  }
}

/** Electron <webview> methods/events Jarvis uses. */
export interface WebviewElement extends HTMLWebViewElement {
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.jarvis?.isDesktop;

export function openExternal(url: string): void {
  if (window.jarvis) void window.jarvis.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export const isMac = (): boolean => window.jarvis?.platform === 'darwin';

/** Saves text through the native dialog on desktop, or as a browser download. */
export async function saveTextFile(name: string, content: string, mime: string): Promise<void> {
  if (window.jarvis) {
    await window.jarvis.saveFile(name, content);
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function fileSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chat';
}
