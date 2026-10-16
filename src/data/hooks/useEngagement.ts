import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import { engagementOf, EMPTY_ENGAGEMENT, type Engagement } from '@/data/engagement';
import { scheduler, type Lane } from '@/data/scheduler';

const same = (a: Engagement, b: Engagement): boolean =>
  a.replies === b.replies &&
  a.zaps === b.zaps &&
  a.capped === b.capped;

/**
 * Live counts for one note, from the ref index. Declares an engagement
 * want so the relays that served the note are asked about it. No id
 * (private items): no counts and no want — a rumor id is unresolvable on
 * relays and asking about one leaks the query.
 */
export const useEngagement = (
  id: string | undefined,
  lane: Lane = 'interactive',
): Engagement & { pending: boolean } => {
  const cache = useRef<Engagement>(EMPTY_ENGAGEMENT);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(eventKey(id ?? ''), onChange),
    [id],
  );

  const snapshot = useCallback((): Engagement => {
    if (!id) return EMPTY_ENGAGEMENT;
    const next = engagementOf(store, id);
    if (same(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    scheduler.want({ type: 'engagement', target: id }, lane);
    return () => scheduler.drop({ type: 'engagement', target: id });
  }, [id, lane]);

  const counts = useSyncExternalStore(subscribe, snapshot, snapshot);
  // The engagement want settles a synthetic entity when its first run
  // completes — until then the numbers are unknown, not zero.
  const settleKey = id ? `engagement:${id}` : '';
  const settle = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(settleKey, onChange), [settleKey]),
    useCallback(() => store.get(settleKey), [settleKey]),
    useCallback(() => store.get(settleKey), [settleKey]),
  );
  return { ...counts, pending: id !== undefined && settle.settledAt === undefined };
};
