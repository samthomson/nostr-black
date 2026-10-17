import { useCallback, useRef, useSyncExternalStore } from 'react';
import { store } from '@/data/store';

export interface StoreSummary {
  events: number;
  replaceable: number;
  addressable: number;
}

const EMPTY: StoreSummary = Object.freeze({ events: 0, replaceable: 0, addressable: 0 });

/** Live inventory of what the event store holds. */
export const useStoreSummary = (): StoreSummary => {
  const cache = useRef<StoreSummary>(EMPTY);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.watch({
        onIngest: () => onChange(),
        onClear: () => onChange(),
      }),
    [],
  );

  const snapshot = useCallback((): StoreSummary => {
    const next = store.summary();
    const prev = cache.current;
    if (
      prev.events === next.events &&
      prev.replaceable === next.replaceable &&
      prev.addressable === next.addressable
    ) {
      return prev;
    }
    cache.current = next;
    return next;
  }, []);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
