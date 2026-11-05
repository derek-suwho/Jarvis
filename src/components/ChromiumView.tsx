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
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const landedUrl = useRef(url);
  const ready = useRef(false);
  const pendingReload = useRef(false);
  const requested = useRef<string | null>(url);
  const loadGeneration = useRef(0);
  const mounted = useRef(false);
  const reloadPage = (wv: WebviewElement) => {
    loadGeneration.current++;
    requested.current = landedUrl.current;
    setFailed(false);
    setLoading(true);
    try {
      wv.reload();
      return true;
    } catch {
      setLoading(false);
      setFailed(true);
      return false;
    }
  };
  const loadAddress = (wv: WebviewElement, address: string) => {
    const generation = ++loadGeneration.current;
    setFailed(false);
    setLoading(true);
    const onError = (error: unknown) => {
      if (!mounted.current || generation !== loadGeneration.current) return;
      const code = (error as { code?: string; errno?: number } | null)?.code;
      const errno = (error as { errno?: number } | null)?.errno;
      if (code !== 'ERR_ABORTED' && errno !== -3) {
        setLoading(false);
        setFailed(true);
      }
    };
    try {
      void wv.loadURL(address).catch(onError);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    mounted.current = true;
    const onReady = () => {
      if (ready.current) return;
      ready.current = true;
      // Load a queued address only when it differs from the document already landed.
      if (lastUrl.current !== landedUrl.current) {
        requested.current = lastUrl.current;
        loadAddress(wv, lastUrl.current);
      } else if (pendingReload.current) {
        reloadPage(wv);
      }
      pendingReload.current = false;
    };
    const onNav = (e: Event) => {
      const { url: landed, isMainFrame } = e as NavEvent;
      if (isMainFrame === false) return;
      loadGeneration.current++;
      const wasRequested = requested.current !== null;
      requested.current = null;
      // Once ready, history reflects the loaded document without loading it again.
      // Before readiness, follow redirects unless an address change is already queued.
      if (ready.current || lastUrl.current === landedUrl.current) lastUrl.current = landed;
      landedUrl.current = landed;
      onNavigateRef.current(landed, wasRequested);
    };
    const onLoading = () => { setFailed(false); setLoading(true); };
    const onStopped = () => setLoading(false);
    const onRendererGone = () => {
      loadGeneration.current++;
      setLoading(false);
      setFailed(true);
    };
    const onFailure = (event: Event) => {
      const { isMainFrame, errorCode } = event as Event & { isMainFrame: boolean; errorCode: number };
      // ERR_ABORTED is expected when another navigation replaces a pending one.
      if (isMainFrame && errorCode !== -3) { setLoading(false); setFailed(true); }
    };
    wv.addEventListener('did-start-loading', onLoading);
    wv.addEventListener('did-stop-loading', onStopped);
    wv.addEventListener('render-process-gone', onRendererGone);
    wv.addEventListener('did-fail-load', onFailure);
    wv.addEventListener('dom-ready', onReady);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      mounted.current = false;
      loadGeneration.current++;
      wv.removeEventListener('did-start-loading', onLoading);
      wv.removeEventListener('did-stop-loading', onStopped);
      wv.removeEventListener('render-process-gone', onRendererGone);
      wv.removeEventListener('did-fail-load', onFailure);
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
    if (ready.current && ref.current) loadAddress(ref.current, url);
  }, [url]);

  const firstReload = useRef(true);
  useEffect(() => {
    if (firstReload.current) {
      firstReload.current = false;
      return;
    }
    if (ready.current && ref.current) {
      if (lastUrl.current !== landedUrl.current) {
        requested.current = lastUrl.current;
        loadAddress(ref.current, lastUrl.current);
      } else reloadPage(ref.current);
    } else pendingReload.current = true;
  }, [reloadKey]);

  // React would drop a boolean `allowpopups`; Electron needs the attribute present so popups reach the main process handler.
  const popups = { allowpopups: 'true' } as object;
  return <>
    <webview ref={ref} aria-label="Web page" aria-busy={loading} className="chromium" src={initialUrl} partition="persist:jarvis-browser" {...popups} />
    {loading && <div className="embed-hint" role="status">Loading page…</div>}
    {failed && <div className="embed-hint" role="alert">
      Unable to load this page. Check your connection or try another address.{' '}
      <button onClick={() => {
        if (!mounted.current) return;
        const wv = ref.current;
        if (!wv) return;
        let started: boolean;
        if (lastUrl.current !== landedUrl.current) {
          requested.current = lastUrl.current;
          started = loadAddress(wv, lastUrl.current);
        } else started = reloadPage(wv);
        if (started) wv.focus?.();
      }}>Retry</button>
    </div>}
  </>;
}
