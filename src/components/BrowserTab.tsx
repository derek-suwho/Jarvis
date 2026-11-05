import { useEffect, useId, useRef, useState } from 'react';
import type { BrowserState } from '../lib/tabs';
import { isDesktop, openExternal } from '../lib/desktop';
import {
  canGoBack,
  canGoForward,
  currentUrl,
  goBack,
  goForward,
  navigate,
  normalizeUrl,
  reload,
  replaceCurrent,
} from '../lib/tabs';
import { ChromiumView } from './ChromiumView';
import { SiteIcon } from './SiteIcon';
import { ArrowLeftIcon, ArrowRightIcon, ExternalIcon, ReloadIcon, SideChatIcon } from './Icons';

interface Props {
  state: BrowserState;
  active?: boolean;
  onChange: (s: BrowserState) => void;
  onOpenSideChat: () => void;
}

const SUGGESTED = [
  { label: 'Google', url: 'https://www.google.com/' },
  { label: 'Gmail', url: 'https://mail.google.com/' },
  { label: 'YouTube', url: 'https://www.youtube.com/' },
  { label: 'GitHub', url: 'https://github.com/' },
];

export function BrowserTab({ state, active = true, onChange, onOpenSideChat }: Props) {
  const url = currentUrl(state);
  const [address, setAddress] = useState(url ?? '');
  const [externalError, setExternalError] = useState('');
  const [addressError, setAddressError] = useState('');
  const externalErrorId = useId();
  const addressErrorId = `${externalErrorId}-address`;
  const externalRequest = useRef(0);
  const addressRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    externalRequest.current++;
    setAddress(url ?? '');
    setAddressError('');
    setExternalError('');
    return () => { externalRequest.current++; };
  }, [url]);

  const launchExternal = () => {
    const request = ++externalRequest.current;
    setExternalError('');
    if (url) return openExternal(url, (message) => {
      if (request === externalRequest.current) setExternalError(message);
    });
  };

  const updatePage = (next: BrowserState) => {
    externalRequest.current++;
    try {
      onChange(next);
      setExternalError('');
    } catch {
      setExternalError('Could not update the page. Try the browser control again.');
    }
  };

  const desktop = isDesktop();

  // Pages navigating on their own (link clicks) add history; redirects of a page we asked for replace it.
  const onPageNavigate = (landed: string, redirect: boolean) => {
    if (landed === url) return;
    updatePage(redirect ? replaceCurrent(state, landed) : navigate(state, landed));
  };

  const go = (input: string) => {
    const next = normalizeUrl(input);
    if (next) {
      externalRequest.current++;
      try {
        onChange(next === url ? reload(state) : navigate(state, next));
        setAddressError('');
        setExternalError('');
      } catch {
        if (input !== address) setAddress(input);
        setAddressError('Could not navigate. Your address is still here. Try again.');
        const field = addressRef.current;
        const selection = field && input === address
          ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }
          : null;
        field?.focus();
        if (selection && selection.start !== null && selection.end !== null) {
          field?.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
        }
      }
    } else if (input.trim()) {
      setAddressError('Enter a valid http:// or https:// address, or a search term.');
    } else {
      setAddressError('Enter an address or search term.');
    }
  };

  return (
    <div className="browser">
      <div className="browser-toolbar" onKeyDown={(event) => {
        if (!event.defaultPrevented && !event.repeat && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && event.key.toLowerCase() === 'l' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          addressRef.current?.focus();
          addressRef.current?.select();
          return;
        }
        if (!event.defaultPrevented && !event.repeat && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && url && (
          (event.key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey)) ||
          (event.key === 'F5' && !event.metaKey && !event.ctrlKey)
        )) {
          event.preventDefault();
          event.stopPropagation();
          updatePage(reload(state));
          return;
        }
        if (event.defaultPrevented || event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'ArrowLeft' && canGoBack(state)) updatePage(goBack(state));
        else if (event.key === 'ArrowRight' && canGoForward(state)) updatePage(goForward(state));
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}>
        <button className="icon-btn" title="Back (Alt+Left)" aria-keyshortcuts="Alt+ArrowLeft" aria-describedby={externalError ? externalErrorId : undefined} disabled={!canGoBack(state)} onClick={() => updatePage(goBack(state))}>
          <ArrowLeftIcon />
        </button>
        <button
          className="icon-btn"
          title="Forward (Alt+Right)"
          aria-keyshortcuts="Alt+ArrowRight"
          aria-describedby={externalError ? externalErrorId : undefined}
          disabled={!canGoForward(state)}
          onClick={() => updatePage(goForward(state))}
        >
          <ArrowRightIcon />
        </button>
        <button className="icon-btn" title="Reload (⌘R / Ctrl+R / F5)" aria-keyshortcuts="Meta+R Control+R F5" aria-describedby={externalError ? externalErrorId : undefined} disabled={!url} onClick={() => updatePage(reload(state))}>
          <ReloadIcon />
        </button>
        <input
          ref={addressRef}
          className="address-bar"
          aria-keyshortcuts="Meta+L Control+L"
          aria-label="Search or enter a URL"
          aria-invalid={addressError ? true : undefined}
          aria-describedby={addressError ? addressErrorId : undefined}
          placeholder="Search or enter a URL"
          value={address}
          autoFocus={!url}
          onChange={(e) => { setAddress(e.target.value); setAddressError(''); }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.defaultPrevented || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              setAddress(url ?? '');
              setAddressError('');
              return;
            }
            if (e.key === 'Enter' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) go(address);
          }}
        />
        <button
          className="icon-btn"
          title="Open in system browser"
          aria-describedby={externalError ? externalErrorId : undefined}
          disabled={!url}
          onClick={launchExternal}
        >
          <ExternalIcon />
        </button>
      </div>

      {addressError && <p id={addressErrorId} className="task-error" role="alert">{addressError}</p>}
      {externalError && <p id={externalErrorId} className="task-error" role="alert">{externalError}</p>}
      {externalError && <button className="task-action" aria-label="Dismiss browser error" onClick={() => { externalRequest.current++; setExternalError(''); addressRef.current?.focus(); }}>Dismiss</button>}

      {url ? active && (
        <div className="browser-viewport">
          {desktop ? (
            <ChromiumView url={url} reloadKey={state.reloadKey} onNavigate={onPageNavigate} />
          ) : (
            <>
              <iframe
                key={`${state.index}:${state.reloadKey}`}
                src={url}
                title={url}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                referrerPolicy="no-referrer"
              />
              <div className="embed-hint">
                Blank page? Many sites (Google, GitHub…) block embedding. Run <code>npm run desktop:dev</code> for the
                full Chromium browser. <button onClick={launchExternal}>Open externally</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="newtab-page">
          <section>
            <h3>Tools</h3>
            <div className="tool-grid">
              <button className="tool-card" onClick={onOpenSideChat}>
                <SideChatIcon />
                <span>Side chat</span>
                <span className="kbd">⌥⌘S</span>
              </button>
            </div>
          </section>
          <section>
            <h3>Suggested</h3>
            <div className="suggested-grid">
              {SUGGESTED.map((s) => (
                <button key={s.url} className="site-tile" onClick={() => go(s.url)}>
                  <span className="site-icon">
                    <SiteIcon site={s.url} size={24} fallback={s.label[0]} />
                  </span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
