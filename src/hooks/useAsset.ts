import { useEffect, useRef, useState } from 'react';
import { isDesktop } from '@/net/runtime';
import { fetchAssetUrl, prioritizeAsset, type MediaKind } from '@/net/media';

export interface Asset {
  /** Renderable URL — undefined while loading or after failure. */
  url: string | undefined;
  /** Short failure reason, shown by callers that surface errors. */
  error: string | undefined;
}

/**
 * Resolves a media URL to something renderable.
 *
 * Web: identity — the browser fetches over https directly.
 * Desktop: bytes are fetched through Rust (Tor or direct, throttled and
 * time-boxed in fetchAssetUrl) and cached as a blob URL — the webview
 * never makes a network request itself. Errors are returned, not swallowed.
 *
 * Attach `ref` to the element; when it scrolls into view the fetch is
 * promoted to the front of the queue (viewport media loads first).
 */
export function useAsset(
  url: string | undefined,
  kind: MediaKind = 'media',
): Asset & { ref: React.RefObject<HTMLDivElement | null> } {
  const desktop = isDesktop();
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!url || !desktop) return;
    let alive = true;
    fetchAssetUrl(url, kind)
      .then((u) => {
        if (alive) {
          setBlobUrl(u);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e).slice(0, 120));
      });
    return () => {
      alive = false;
    };
  }, [url, kind, desktop]);

  // Viewport boost: seeing it means wanting it now.
  useEffect(() => {
    if (!url || !desktop || blobUrl) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        prioritizeAsset(url);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [url, desktop, blobUrl]);

  if (url && !desktop) return { url, error: undefined, ref };
  return { url: blobUrl, error, ref };
}
