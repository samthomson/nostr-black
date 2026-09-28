import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { queryRelay, queryRelays, getEventRoute, type TransportRoute } from '@/net/net';
import { parseFollows, buildAuthorRelayMap, buildRelayGroups } from '@/lib/outbox';
import { readRelays, writeRelays } from '@/lib/appRelays';


/** Feed kinds: notes, reposts (6/16), pictures, video, files, long-form. */
const FEED_KINDS = [1, 6, 16, 20, 21, 1063, 30023];

interface FeedQueryResult {
  notes: NostrEvent[];
  foundOn: Record<string, string[]>;
  foundRoute: Record<string, TransportRoute | undefined>;
}
/** Concurrency, not coverage: every declared relay is queried, in waves of
 * this many simultaneous connections. */
const MAX_PARALLEL_RELAYS = 8;
const LIMIT_PER_RELAY = 100;
const FEED_SIZE = 100;

/**
 * Outbox-model feed (NIP-65). Three stages, all through the owned relay
 * client (src/net/net):
 *   1. the user's own kind 0 + kind 3 (their write relays ∪ discovery set),
 *   2. where each followed author publishes (kind 10002),
 *   3. notes queried only on the relays their authors declared.
 * Never a public firehose; authors without a NIP-65 list are not queried.
 *
 * Stage 3 renders progressively: each wave's results prepend to the feed as
 * a sorted block, and nothing already rendered ever moves — batch-arrival
 * order is the presentation order (persisted verbatim by the future cache;
 * see README, feed order persistence).
 */
export const useOutboxFeed = () => {
  const { user } = useCurrentUser();
  const { config, relaySyncedAt } = useAppContext();
  /** Ordered batches: newest wave first; each batch internally sorted. */
  const [batches, setBatches] = useState<NostrEvent[][]>([]);
  const [foundOn, setFoundOn] = useState<Record<string, string[]>>({});
  const [foundRoute, setFoundRoute] = useState<Record<string, TransportRoute | undefined>>({});
  const seen = useRef(new Set<string>());

  const prependBatch = useCallback(
    (events: NostrEvent[], relays: Record<string, string[]>) => {
      // Dedupe eagerly (before the state update) — later waves may arrive
      // before React commits, and the updater itself must stay pure.
      const byId = new Map(events.map((e) => [e.id, e]));
      const fresh = [...byId.values()].filter((e) => !seen.current.has(e.id));
      for (const e of fresh) seen.current.add(e.id);
      if (fresh.length > 0) {
        // The batch itself is sorted newest-first; it becomes the new head of
        // the feed. Nothing already rendered ever moves.
        const batch = [...fresh].sort((a, b) => b.created_at - a.created_at);
        setBatches((prev) => [batch, ...prev]);
        setFoundRoute((prev) => {
          const next = { ...prev };
          for (const e of fresh) next[e.id] = getEventRoute(e);
          return next;
        });
      }
      if (Object.keys(relays).length > 0) {
        setFoundOn((prev) => ({ ...prev, ...relays }));
      }
    },
    [],
  );

  // Boot query targets the user's own write relays ∪ discovery relays —
  // uncapped (the user chose these), and discovery is user-configurable.
  const bootRelays = [
    ...new Set([
      ...writeRelays(config),
      ...config.discoveryRelays,
    ]),
  ];

  // Jumble-style boot: kind 0 (profile) and kind 3 (follows) in one REQ.
  const follows = useQuery({
    queryKey: [
      'outbox', 'boot',
      user?.pubkey,
      config.relayMetadata.updatedAt,
      config.discoveryRelays.join(','),
    ],
    enabled: !!user,
    queryFn: (c) =>
      queryRelays(bootRelays, [{ kinds: [0, 3], authors: [user!.pubkey] }], { signal: c.signal }),
  });

  const contactList = follows.data
    ?.filter((e) => e.kind === 3)
    .sort((a, b) => b.created_at - a.created_at)[0];
  const followSet = parseFollows(contactList);

  const relayLists = useQuery({
    queryKey: ['outbox', 'relaylists', followSet.join(',')],
    enabled: followSet.length > 0,
    queryFn: (c) =>
      queryRelays(
        readRelays(config),
        [{ kinds: [10002], authors: followSet }],
        { signal: c.signal },
      ),
  });

  const allowed = new Set(followSet);

  const feed = useQuery({
    queryKey: [
      'outbox', 'feed',
      followSet.join(','),
      (relayLists.data ?? []).map((e) => e.id).join(','),
    ],
    enabled: !!relayLists.data,
    queryFn: async (c) => {
      const groups = buildRelayGroups(
        followSet,
        buildAuthorRelayMap(relayLists.data ?? []),
      );

      // Every declared relay is queried — in bounded waves, each wave's
      // results prepended to the feed as a block the moment it lands.
      // The query ALSO returns the full result: TanStack caches it, so a
      // remount (lock/unlock, navigation) repopulates instantly instead of
      // flashing "no notes" while state rebuilds.
      const entries = [...groups.entries()];
      const allEvents: NostrEvent[] = [];
      const foundOnAll: Record<string, string[]> = {};
      const foundRouteAll: Record<string, TransportRoute | undefined> = {};
      for (let i = 0; i < entries.length; i += MAX_PARALLEL_RELAYS) {
        if (allEvents.length >= FEED_SIZE) break;
        const wave = entries.slice(i, i + MAX_PARALLEL_RELAYS);
        const waveResults = await Promise.all(
          wave.map(async ([url, authors]) => {
            const events = await queryRelay(
              url,
              [{ kinds: FEED_KINDS, authors, limit: LIMIT_PER_RELAY }],
              { signal: c.signal },
            );
            const relays: Record<string, string[]> = {};
            for (const e of events) {
              relays[e.id] = [...(relays[e.id] ?? []), url];
            }
            return { events, relays };
          }),
        );

        const waveEvents = waveResults
          .flatMap((r) => r.events)
          .filter((e) => allowed.has(e.pubkey))
          .slice(0, Math.max(0, FEED_SIZE - allEvents.length));
        const waveRelays = Object.assign({}, ...waveResults.map((r) => r.relays));
        for (const e of waveEvents) foundRouteAll[e.id] = getEventRoute(e);
        allEvents.push(...waveEvents);
        Object.assign(foundOnAll, waveRelays);
        if (waveEvents.length > 0) prependBatch(waveEvents, waveRelays);
      }

      return { notes: allEvents, foundOn: foundOnAll, foundRoute: foundRouteAll };
    },
  });

  // Verdicts wait for discovery to settle: until the first NIP-65 sync
  // attempt completes, "empty" results may just mean we asked the wrong
  // relays — the user sees loading, not a broken-looking feed.
  const discoverySettled = relaySyncedAt !== undefined;
  const settled = follows.isSuccess && discoverySettled;
  const feedData = feed.data as FeedQueryResult | undefined;

  // Progressive batches when live; cached query result when remounting
  // (lock/unlock, navigation) — one derivation, no scattered conditionals.
  const notes = batches.length > 0 ? batches.flat() : (feedData?.notes ?? []);

  return {
    notes,
    foundOn: batches.length > 0 ? foundOn : (feedData?.foundOn ?? {}),
    foundRoute: batches.length > 0 ? foundRoute : (feedData?.foundRoute ?? {}),
    isLoading:
      (follows.isLoading || relayLists.isLoading || feed.isLoading) || (!discoverySettled && notes.length === 0),
    // Only claim "not following anyone" from an actual (empty) contact list.
    noFollows: settled && !!contactList && followSet.length === 0,
    followsNotFound: settled && !contactList,
  };
};
