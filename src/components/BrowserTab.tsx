import { useEffect, useState } from 'react';
import type { BrowserState } from '../lib/tabs';
import { canGoBack, canGoForward, currentUrl, goBack, goForward, navigate, normalizeUrl, reload } from '../lib/tabs';
import { ArrowLeftIcon, ArrowRightIcon, ExternalIcon, ReloadIcon, SideChatIcon } from './Icons';

interface Props {
  state: BrowserState;
  onChange: (s: BrowserState) => void;
  onOpenSideChat: () => void;
}

// Sites that allow being embedded in an iframe.
const SUGGESTED = [
  { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', color: '#e2e8f0' },
  { label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-122.52,37.70,-122.35,37.83&layer=mapnik', color: '#7ebc6f' },
  { label: 'Excalidraw', url: 'https://excalidraw.com/', color: '#a5a3ff' },
  { label: 'Example', url: 'https://example.com/', color: '#22d3ee' },
];

export function BrowserTab({ state, onChange, onOpenSideChat }: Props) {
  const url = currentUrl(state);
  const [address, setAddress] = useState(url ?? '');

  useEffect(() => setAddress(url ?? ''), [url]);

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
          onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
        >
          <ExternalIcon />
        </button>
      </div>

      {url ? (
        <div className="browser-viewport">
          <iframe
            key={`${state.index}:${state.reloadKey}`}
            src={url}
            title={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
          <div className="embed-hint">
            Blank page? Many sites (Google, GitHub…) block embedding.{' '}
            <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Open externally</button>
          </div>
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
                  <span className="site-icon" style={{ color: s.color }}>
                    {s.label[0]}
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
