import type { NostrEvent } from '@nostrify/nostrify';
import { parseRelayList, type RelayList } from '@/lib/outbox';
import { store, type EventStore } from './store';
import type { AuthorRelays, RoutingContext, SelfRelays } from './routing';

/**
 * Assembles the routing context: who we are and where we read/write, plus
 * where everybody else publishes.
 *
 * Self lives here rather than in React state because the scheduler is a
 * module singleton and has no context to read — the provider pushes into
 * it, the same way `setRoutePreference` works in `src/net/egress.ts`.
 * Author relays come straight off the event store, so there is exactly one
 * copy of anyone's kind 10002 in the app.
 */

export type Self = SelfRelays;

const EMPTY_SELF: Self = { pubkey: undefined, myRelays: [], discovery: [] };

let current: Self = EMPTY_SELF;

export const getSelf = (): Self => current;

/**
 * Push the current identity and relay config in. Nothing subscribes: the
 * scheduler reads the context when a batch flushes, so the latest value at
 * that moment is the one that routes.
 */
export const setSelf = (next: Self): void => {
  current = next;
};

/**
 * Parsed kind 10002s, memoized on event identity. The store guarantees a
 * stable reference until the event genuinely changes, so this reparses
 * only when someone's relay list actually moves.
 */
export const authorRelaysOf = (source: EventStore): AuthorRelays => {
  const cache = new Map<string, { event: NostrEvent; list: RelayList }>();

  return {
    get: (pubkey) => {
      const event = source.getReplaceable(10002, pubkey);
      if (!event) return undefined;

      const hit = cache.get(pubkey);
      if (hit?.event === event) return hit.list;

      const list = parseRelayList(event);
      cache.set(pubkey, { event, list });
      return list;
    },
  };
};

export const authorRelays: AuthorRelays = authorRelaysOf(store);

export const routingContext = (): RoutingContext => ({ ...current, authorRelays });
