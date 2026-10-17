import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { store, eventKey } from '@/data/store';
import { childrenOf } from '@/data/thread';
import { isPending, useEntity } from './useEntity';

const sameIds = (a: readonly NostrEvent[], b: readonly NostrEvent[]): boolean =>
  a.length === b.length && a.every((event, i) => event.id === b[i].id);

/**
 * Direct children of an opened note. One hop; expanding a child is another
 * want. Engagement for those children is declared by the row that renders
 * them — see `Thread`.
 */
export const useThread = (
  parent: string | undefined,
  author?: string,
): { children: NostrEvent[]; pending: boolean } => {
  const settle = useEntity(
    parent ? { type: 'thread', parent, author } : undefined,
    'interactive',
  );
  const cache = useRef<NostrEvent[]>([]);

  const subscribe = useCallback(
    (onChange: () => void) => (parent ? store.subscribe(eventKey(parent), onChange) : () => {}),
    [parent],
  );

  const snapshot = useCallback((): NostrEvent[] => {
    if (!parent) return [];
    const next = childrenOf(store, parent);
    if (sameIds(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [parent]);

  const children = useSyncExternalStore(subscribe, snapshot, snapshot);

  return {
    children,
    pending: !!parent && isPending(settle),
  };
};
