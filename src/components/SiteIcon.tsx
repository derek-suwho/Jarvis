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
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const imageKey = `${host}:${size}`;
  if (!host || failedImage === imageKey) return <>{fallback}</>;
  return (
    <>
      {loadedImage !== imageKey && fallback}
      <img
        key={imageKey}
        hidden={loadedImage !== imageKey}
        style={loadedImage !== imageKey ? { display: 'none' } : undefined}
        className="site-favicon"
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size * 2}`}
        width={size}
        height={size}
        alt=""
        draggable={false}
        onLoad={() => setLoadedImage(imageKey)}
        onError={() => setFailedImage(imageKey)}
      />
    </>
  );
}
