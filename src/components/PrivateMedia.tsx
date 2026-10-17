import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadPrivateImage, type PrivateImage } from '@/lib/fileMessage';

interface OpenedImage {
  blobUrl: string;
  mime: string;
}

/** Decrypted images by ciphertext hash, shared by every mount — the
 * feed, the thread and re-renders fetch one image once per session.
 * Capped: each entry holds a blob (megabytes post-decrypt), so the
 * oldest entry is evicted and revoked past the cap. */
const CACHE_MAX = 24;
const cache = new Map<string, OpenedImage>();
/** Loads in progress by ciphertext hash — remounts join the running
 * fetch instead of starting a second one (and leaking its blob url). */
const inflight = new Map<string, Promise<OpenedImage>>();

const loadOf = (x: string, image: PrivateImage): Promise<OpenedImage> => {
  const held = inflight.get(x);
  if (held) return held;
  const load = loadPrivateImage(image).finally(() => inflight.delete(x));
  inflight.set(x, load);
  return load;
};

/**
 * One media tag of a private rumor as its decrypted image: fetched,
 * sha256-checked and opened here, in the same card shapes as public
 * media — a private picture that fails is as visible as a public one.
 * The conversation's reply CEK derives the key; the same ciphertext is
 * one cache entry wherever it renders.
 */
export const PrivateMedia = ({ image }: { image: PrivateImage }) => {
  const [loaded, setLoaded] = useState<OpenedImage | undefined>(() => cache.get(image?.x ?? ''));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const x = image?.x;
    if (loaded || !x) return;
    let cancelled = false;
    void loadOf(x, image)
      .then((opened) => {
        cache.set(x, opened);
        while (cache.size > CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          const evicted = cache.get(oldest);
          cache.delete(oldest);
          if (evicted) URL.revokeObjectURL(evicted.blobUrl);
        }
        if (!cancelled) setLoaded(opened);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [image, loaded]);

  // Unmount hands the url back — unless the cache still holds it: a
  // cached url is shared with every other mount of this image.
  useEffect(() => {
    if (!loaded) return;
    return () => {
      if (![...cache.values()].some((v) => v.blobUrl === loaded.blobUrl)) {
        URL.revokeObjectURL(loaded.blobUrl);
      }
    };
  }, [loaded]);
  if (error) {
    return (
      <div className="flex h-20 w-full items-center justify-center rounded-sm border border-dashed px-2 text-center font-mono text-[10px] text-red-500">
        image failed: {error}
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="text-muted-foreground flex h-32 w-full items-center justify-center gap-2 rounded-sm bg-muted text-xs">
        <Loader2 className="size-4 animate-spin" />
        loading image…
      </div>
    );
  }

  return <img src={loaded.blobUrl} alt="" className="max-h-96 w-full rounded-sm object-cover" />;
};
