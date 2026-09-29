import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { store } from '@/data/store';
import { FEED_KINDS } from '@/data/feed/spec';
import { AUTHOR_NOTES_LIMIT } from '@/data/scheduler';
import { isPending, useEntity } from './useEntity';
import { useRelayList } from './useProfile';

const sameIds = (a: readonly NostrEvent[], b: readonly NostrEvent[]): boolean =>
  a.length === b.length && a.every((event, i) => event.id === b[i].id);

/**
 * An author's notes from their outbox. The store is the list — notes the
 * feed already held are here without a second fetch.
 *
 * The notes REQ waits until we know their write relays (or that they have
 * none). Asking earlier hits our inbox, settles empty, and never goes back
 * to their outbox.
 */
export const useAuthorNotes = (
  pubkey: string | undefined,
): { notes: NostrEvent[]; pending: boolean } => {
  const relays = useRelayList(pubkey);
  const routed = relays.list.write.length > 0 || !relays.pending;
  const settle = useEntity(
    pubkey && routed ? { type: 'authorNotes', pubkey } : undefined,
    'interactive',
  );
  const cache = useRef<NostrEvent[]>([]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.watch({
        onIngest: () => onChange(),
        onClear: () => onChange(),
      }),
    [],
  );

  const snapshot = useCallback((): NostrEvent[] => {
    if (!pubkey) return [];
    const next = store.queryByAuthors([pubkey], FEED_KINDS).slice(0, AUTHOR_NOTES_LIMIT);
    if (sameIds(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [pubkey]);

  const notes = useSyncExternalStore(subscribe, snapshot, snapshot);

  return {
    notes,
    pending: !!pubkey && (!routed || isPending(settle)),
  };
};
