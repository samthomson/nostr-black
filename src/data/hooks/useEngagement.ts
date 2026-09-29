import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import { engagementOf, EMPTY_ENGAGEMENT, type Engagement } from '@/data/engagement';
import { scheduler, type Lane } from '@/data/scheduler';

const same = (a: Engagement, b: Engagement): boolean =>
  a.replies === b.replies &&
  a.reactions === b.reactions &&
  a.downvotes === b.downvotes &&
  a.reposts === b.reposts &&
  a.zaps === b.zaps &&
  a.capped === b.capped;

/**
 * Live counts for one note, from the ref index. Declares an engagement
 * want so the relays that served the note are asked about it.
 */
export const useEngagement = (id: string, lane: Lane = 'interactive'): Engagement => {
  const cache = useRef<Engagement>(EMPTY_ENGAGEMENT);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(eventKey(id), onChange),
    [id],
  );

  const snapshot = useCallback((): Engagement => {
    const next = engagementOf(store, id);
    if (same(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [id]);

  useEffect(() => {
    scheduler.want({ type: 'engagement', target: id }, lane);
    return () => scheduler.drop({ type: 'engagement', target: id });
  }, [id, lane]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
