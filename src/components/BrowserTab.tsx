import { useEffect, useState } from 'react';
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
  onChange: (s: BrowserState) => void;
  onOpenSideChat: () => void;
}

const SUGGESTED = [
  { label: 'Google', url: 'https://www.google.com/' },
  { label: 'Gmail', url: 'https://mail.google.com/' },
  { label: 'YouTube', url: 'https://www.youtube.com/' },
  { label: 'GitHub', url: 'https://github.com/' },
];

export function BrowserTab({ state, onChange, onOpenSideChat }: Props) {
  const url = currentUrl(state);
  const [address, setAddress] = useState(url ?? '');

  useEffect(() => setAddress(url ?? ''), [url]);

  const desktop = isDesktop();

  // Pages navigating on their own (link clicks) add history; redirects of a page we asked for replace it.
  const onPageNavigate = (landed: string, redirect: boolean) => {
    if (landed === url) return;
    onChange(redirect ? replaceCurrent(state, landed) : navigate(state, landed));
  };

  const go = (input: string) => {
    const next = normalizeUrl(input);
    if (next) onChange(navigate(state, next));
  };

  return (
    <div className="browser">
      <div className="browser-toolbar">
        <button className="icon-btn" title="Back" disabled={!canGoBack(state)} onClick={() => onChange(goBack(state))}>
          <ArrowLeftIcon />
        </button>
        <button
          className="icon-btn"
          title="Forward"
          disabled={!canGoForward(state)}
          onClick={() => onChange(goForward(state))}
        >
          <ArrowRightIcon />
        </button>
        <button className="icon-btn" title="Reload" disabled={!url} onClick={() => onChange(reload(state))}>
          <ReloadIcon />
        </button>
        <input
          className="address-bar"
          placeholder="Search or enter a URL"
          value={address}
          autoFocus={!url}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && go(address)}
        />
        <button
          className="icon-btn"
          title="Open in system browser"
          disabled={!url}
          onClick={() => url && openExternal(url)}
        >
          <ExternalIcon />
        </button>
      </div>

      {url ? (
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
                full Chromium browser. <button onClick={() => openExternal(url)}>Open externally</button>
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
