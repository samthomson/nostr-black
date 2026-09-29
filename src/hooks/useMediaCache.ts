import { useCallback, useState } from 'react';
import { isDesktop } from '@/net/runtime';
import {
  mediaCacheBytes,
  mediaCacheMaxBytes,
  setMediaCacheMaxBytes,
  clearMediaCache,
} from '@/net/media';

/**
 * Media cache controls (desktop only): live byte usage, budget editing and
 * clearing — the UI surface over src/net/media's two-layer cache.
 */
export function useMediaCache() {
  const [bytes, setBytes] = useState(mediaCacheBytes());

  const refresh = useCallback(() => setBytes(mediaCacheBytes()), []);

  const setMaxMb = useCallback(
    async (mb: number) => {
      await setMediaCacheMaxBytes(mb * 1024 * 1024);
      refresh();
    },
    [refresh],
  );

  const clear = useCallback(async () => {
    await clearMediaCache();
    refresh();
  }, [refresh]);

  return {
    enabled: isDesktop(),
    bytes,
    maxBytes: mediaCacheMaxBytes(),
    setMaxMb,
    clear,
  };
}
