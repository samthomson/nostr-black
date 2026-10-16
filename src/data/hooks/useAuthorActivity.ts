import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { store } from '@/data/store';
import { ACTIVITY_KINDS } from '@/data/scheduler';
import { isPending, useEntity } from './useEntity';

const EMPTY: NostrEvent[] = [];

const sameIds = (a: readonly NostrEvent[], b: readonly NostrEvent[]): boolean =>
  a.length === b.length && a.every((event, i) => event.id === b[i].id);

/**
 * A profile's replaceable activity — profile (0), contacts (3), relay
 * list (10002) — every stored version, newest first. Read from the store's
 * replaceable history, which keeps all versions, not just the latest.
 */
export const useAuthorActivity = (pubkey: string | undefined) => {
  const settle = useEntity(pubkey ? { type: 'authorActivity', pubkey } : undefined, 'interactive');

  const cache = useRef<NostrEvent[]>([]);
  const subscribe = useCallback(
    (onChange: () => void) => store.watch({ onIngest: () => onChange(), onClear: () => onChange() }),
    [],
  );
  const snapshot = useCallback((): NostrEvent[] => {
    if (!pubkey) return EMPTY;
    const next = ACTIVITY_KINDS.flatMap((kind) => store.queryReplaceableHistory(kind, pubkey))
      .sort((a, b) => b.created_at - a.created_at);
    if (sameIds(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [pubkey]);

  const activity = useSyncExternalStore(subscribe, snapshot, snapshot);

  return { activity, pending: !!pubkey && isPending(settle) };
};
