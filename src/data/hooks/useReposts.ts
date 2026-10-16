import { useCallback, useRef, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import { repostsOf, type Repost } from '@/data/engagement';

const EMPTY: readonly Repost[] = [];

const same = (a: readonly Repost[], b: readonly Repost[]): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id);

/** Live repost list for one note — the who, feeding the viewer's
 * reposts tab. Mirrors `useReactions`. */
export const useReposts = (id: string | undefined): readonly Repost[] => {
  const cache = useRef<readonly Repost[]>(EMPTY);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(eventKey(id ?? ''), onChange),
    [id],
  );

  const snapshot = useCallback((): readonly Repost[] => {
    if (!id) return EMPTY;
    const next = repostsOf(store, id);
    if (same(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [id]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
