import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from './useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { queryRelay, queryRelays, getEventRoute, type TransportRoute } from '@/net/net';
import { mergeFeed } from '@/lib/outbox';
import { buildAuthorRelayMap, buildRelayGroups } from '@/lib/outbox';
import { mergeRelays } from '@/lib/mergeRelays';
import { readRelays } from '@/lib/appRelays';


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
  const { config } = useAppContext();
  const { state: userState, relaySyncedAt } = useUserState();
  /** The feed: one list, newest-first, merged chronologically as waves land. */
  const [feed, setFeed] = useState<NostrEvent[]>([]);
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
        // Waves merge at their chronological position — relay arrival order
        // must not cluster one author's backlog into a wall.
        setFeed((prev) => mergeFeed(prev, fresh));
        setFoundRoute((prev) => {
          const next = { ...prev };
          for (const e of fresh) next[e.id] = getEventRoute(e);
          return next;
        });
      }
      if (Object.keys(relays).length > 0) {
        setFoundOn((prev) => mergeRelays({ ...prev }, relays));
      }
    },
    [],
  );

  // The follow list is STORED STATE (synced by useNostrSync into config),
  // never re-derived per mount — relays failing during one navigation can't
  // blank it, and it survives restarts.
  const followSet = userState.follows.pubkeys;

  const relayLists = useQuery({
    queryKey: ['outbox', 'relaylists', followSet.join(',')],
    enabled: followSet.length > 0,
    queryFn: (c) =>
      queryRelays(
        readRelays(userState, config),
        [{ kinds: [10002], authors: followSet }],
        { signal: c.signal },
      ),
  });

  const allowed = new Set(followSet);

  const feedQuery = useQuery({
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
        const waveRelays: Record<string, string[]> = {};
        for (const r of waveResults) mergeRelays(waveRelays, r.relays);
        for (const e of waveEvents) foundRouteAll[e.id] = getEventRoute(e);
        allEvents.push(...waveEvents);
        // keep the cached full result chronological too
        mergeRelays(foundOnAll, waveRelays);
        if (waveEvents.length > 0) prependBatch(waveEvents, waveRelays);
      }

      return { notes: allEvents, foundOn: foundOnAll, foundRoute: foundRouteAll };
    },
  });

  // Verdicts wait for discovery to settle: until the first NIP-65 sync
  // attempt completes, "empty" results may just mean we asked the wrong
  // relays — the user sees loading, not a broken-looking feed.
  const discoverySettled = relaySyncedAt !== undefined;
  // "Not found" only from a settled sync with no stored list.
  const settled = discoverySettled;
  const followsNotFound = settled && userState.follows.updatedAt === 0;
  const feedData = feedQuery.data as FeedQueryResult | undefined;

  // Live merged feed; cached query result when remounting (lock/unlock,
  // navigation) — one derivation, no scattered conditionals.
  const notes = feed.length > 0 ? feed : (feedData?.notes ?? []);

  return {
    notes,
    foundOn: feed.length > 0 ? foundOn : (feedData?.foundOn ?? {}),
    foundRoute: feed.length > 0 ? foundRoute : (feedData?.foundRoute ?? {}),
    // Loading until the follow sync has settled and the derived queries run.
    isLoading:
      !discoverySettled || relayLists.isLoading || feedQuery.isLoading,
    // Only claim "not following anyone" from a synced empty list.
    noFollows: settled && userState.follows.updatedAt > 0 && followSet.length === 0,
    followsNotFound,
  };
};
