import type { ReactNode } from 'react';
import { useState } from 'react';

interface Props {
  /** Full URL or bare domain. */
  site: string;
  size?: number;
  fallback: ReactNode;
}

function hostOf(site: string): string | null {
  try {
    return new URL(site.includes('://') ? site : `https://${site}`).hostname;
  } catch {
    return null;
  }
}

/** Site favicon via Google's favicon service; shows `fallback` until it loads or if it fails. */
export function SiteIcon({ site, size = 16, fallback }: Props) {
  const host = hostOf(site);
  const [failedHost, setFailedHost] = useState<string | null>(null);
  if (!host || failedHost === host) return <>{fallback}</>;
  return (
    <img
      className="site-favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size * 2}`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailedHost(host)}
    />
  );
}
