/** Bridge exposed by electron/preload.cjs; absent when running in a normal browser. */
interface JarvisBridge {
  isDesktop: true;
  openExternal: (url: string) => Promise<void>;
}

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
