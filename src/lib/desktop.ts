export interface ChatGPTStatus {
  connected: boolean;
  email: string | null;
  registered: boolean;
}

export type ChatGPTSignInResult = { ok: true; status: ChatGPTStatus } | { ok: false; error: string };

/** Bridge exposed by electron/preload.cjs; absent when running in a normal browser. */
interface JarvisBridge {
  isDesktop: true;
  platform: string;
  openExternal: (url: string) => Promise<void>;
  chatgpt: {
    status: () => Promise<ChatGPTStatus>;
    signIn: () => Promise<ChatGPTSignInResult>;
    cancel: () => Promise<void>;
    signOut: () => Promise<{ ok: boolean; revoked: boolean }>;
  };
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
