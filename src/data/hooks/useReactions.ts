import { useCallback, useRef, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import { reactionsOf, type Reaction } from '@/data/engagement';

const EMPTY: readonly Reaction[] = [];

const same = (a: readonly Reaction[], b: readonly Reaction[]): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.pubkey === b[i].pubkey && r.content === b[i].content);

/**
 * Live reaction list for one note — the who, not just the count. Feeds
 * the engagement viewer. Mirrors `useEngagement`: same ref index, same
 * want; no id (private items) means no list and no relay ask.
 */
export const useReactions = (id: string | undefined): readonly Reaction[] => {
  const cache = useRef<readonly Reaction[]>(EMPTY);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(eventKey(id ?? ''), onChange),
    [id],
  );

  const snapshot = useCallback((): readonly Reaction[] => {
    if (!id) return EMPTY;
    const next = reactionsOf(store, id);
    if (same(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [id]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
