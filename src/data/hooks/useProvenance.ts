import { useCallback, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import { getEventRoute, type TransportRoute } from '@/net/net';

export interface Provenance {
  /** Relays that served this event. Grows if a late one also has it. */
  foundOn: string[] | undefined;
  route: TransportRoute | undefined;
}

/**
 * Where an event came from, read from the store rather than threaded down
 * as props. A late relay answering after a page sealed adds to `foundOn`,
 * and the note updates without the page moving.
 */
export const useProvenance = (id: string): Provenance => {
  const key = eventKey(id);

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(key, onChange),
    [key],
  );
  const snapshot = useCallback(() => store.get(key), [key]);

  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  return {
    foundOn: state.foundOn ? [...state.foundOn] : undefined,
    route: state.event ? getEventRoute(state.event) : undefined,
  };
};
