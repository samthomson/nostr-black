import { useCallback, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';

/**
 * Whether the event at `id` is currently a local optimistic copy awaiting
 * its relay confirmation. Reactive: flips false the moment the real event
 * (same id) arrives through the subscription and replaces the tentative one
 * — the note row drops its dim the instant the store holds the confirmed
 * copy.
 */
export const useTentative = (id: string | undefined): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => (id ? store.subscribe(eventKey(id), onChange) : () => {}),
    [id],
  );
  const snapshot = useCallback(
    () => (id ? store.get(eventKey(id)).tentative === true : false),
    [id],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
