import { useCallback, useRef, useSyncExternalStore } from 'react';
import { store } from '@/data/store';
import { FOLLOWER_CAP } from '@/data/scheduler';
import { isPending, useEntity } from './useEntity';

export interface FollowerSample {
  count: number;
  capped: boolean;
  pending: boolean;
}

const mentions = (pubkey: string) =>
  store.queryByKind(3).filter((event) => event.tags.some(([name, value]) => name === 'p' && value === pubkey));

/**
 * Bounded reverse lookup: kind 3 lists that tag this pubkey. Hitting the
 * cap means the number is a floor — the UI must say so.
 */
export const useFollowers = (pubkey: string | undefined): FollowerSample => {
  const settle = useEntity(
    pubkey ? { type: 'followers', pubkey } : undefined,
    'interactive',
  );
  const cache = useRef({ count: 0, capped: false });

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.watch({
        onIngest: () => onChange(),
        onClear: () => onChange(),
      }),
    [],
  );

  const snapshot = useCallback((): { count: number; capped: boolean } => {
    if (!pubkey) return cache.current;
    const sample = mentions(pubkey);
    const next = {
      count: new Set(sample.map((event) => event.pubkey)).size,
      capped: sample.length >= FOLLOWER_CAP,
    };
    const prev = cache.current;
    if (prev.count === next.count && prev.capped === next.capped) return prev;
    cache.current = next;
    return next;
  }, [pubkey]);

  const sample = useSyncExternalStore(subscribe, snapshot, snapshot);

  return {
    count: sample.count,
    capped: sample.capped,
    pending: !!pubkey && isPending(settle),
  };
};
