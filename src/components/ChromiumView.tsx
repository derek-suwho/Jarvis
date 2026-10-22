import { useEffect, useRef, useState } from 'react';
import type { WebviewElement } from '../lib/desktop';

interface Props {
  url: string;
  reloadKey: number;
  /** `redirect` is true when the page landed somewhere other than the URL Jarvis asked for. */
  onNavigate: (url: string, redirect: boolean) => void;
}

type NavEvent = Event & { url: string; isMainFrame?: boolean };

/** Embedded Chromium page (Electron <webview>), with cookies kept across launches. */
export function ChromiumView({ url, reloadKey, onNavigate }: Props) {
  const ref = useRef<WebviewElement>(null);
  const [initialUrl] = useState(url);
  const ready = useRef(false);
  const requested = useRef<string | null>(url);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onReady = () => {
      ready.current = true;
    };
    const onNav = (e: Event) => {
      const { url: landed, isMainFrame } = e as NavEvent;
      if (isMainFrame === false) return;
      const wasRequested = requested.current !== null;
      requested.current = null;
      onNavigateRef.current(landed, wasRequested);
    };
    wv.addEventListener('dom-ready', onReady);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
    };
  }, []);

  // Address bar / back / forward: load the new URL in place rather than remounting.
  const lastUrl = useRef(url);
  useEffect(() => {
    if (url === lastUrl.current) return;
    lastUrl.current = url;
    requested.current = url;
    if (ready.current) void ref.current?.loadURL(url);
  }, [url]);

  const firstReload = useRef(true);
  useEffect(() => {
    if (firstReload.current) {
      firstReload.current = false;
      return;
    }
    if (ready.current) ref.current?.reload();
  }, [reloadKey]);

  // React would drop a boolean `allowpopups`; Electron needs the attribute present so popups reach the main process handler.
  const popups = { allowpopups: 'true' } as object;
  return <webview ref={ref} className="chromium" src={initialUrl} partition="persist:jarvis-browser" {...popups} />;
}
