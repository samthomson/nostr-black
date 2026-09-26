import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { queryRelay, queryRelays } from '@/net/relayClient';
import { parseFollows, buildAuthorRelayMap, buildRelayGroups } from '@/lib/outbox';
import { readRelays, writeRelays } from '@/lib/appRelays';


/** Feed kinds: notes, reposts (6/16), pictures, video, files, long-form. */
const FEED_KINDS = [1, 6, 16, 20, 21, 1063, 30023];
/** Concurrency, not coverage: every declared relay is queried, in waves of
 * this many simultaneous connections. */
const MAX_PARALLEL_RELAYS = 8;
const LIMIT_PER_RELAY = 100;
const FEED_SIZE = 100;

/**
 * Outbox-model feed (NIP-65). Three stages, all through the owned relay
 * client (src/net/relayClient):
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
  const seen = useRef(new Set<string>());

  const prependBatch = useCallback((events: NostrEvent[], relays: Record<string, string[]>) => {
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
    }
    if (Object.keys(relays).length > 0) {
      setFoundOn((prev) => ({ ...prev, ...relays }));
    }
  }, []);

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
      const entries = [...groups.entries()];
      let total = 0;
      for (let i = 0; i < entries.length; i += MAX_PARALLEL_RELAYS) {
        // Headroom check BEFORE fetching the next wave — a wave that's
        // already in flight always lands (the first wave must always
        // render, whatever its size).
        if (total >= FEED_SIZE) break;
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
          // Trim to the remaining render budget so the feed stays bounded
          // (a single wave can hold hundreds of events).
          .slice(0, Math.max(0, FEED_SIZE - total));
        const waveRelays = Object.assign({}, ...waveResults.map((r) => r.relays));
        total += waveEvents.length;
        if (waveEvents.length > 0) prependBatch(waveEvents, waveRelays);
      }

      return total;
    },
  });

  // Verdicts wait for discovery to settle: until the first NIP-65 sync
  // attempt completes, "empty" results may just mean we asked the wrong
  // relays — the user sees loading, not a broken-looking feed.
  const discoverySettled = relaySyncedAt !== undefined;
  const settled = follows.isSuccess && discoverySettled;

  return {
    notes: batches.flat(),
    foundOn,
    isLoading:
      (follows.isLoading || relayLists.isLoading || feed.isLoading) || (!discoverySettled && batches.length === 0),
    // Only claim "not following anyone" from an actual (empty) contact list.
    noFollows: settled && !!contactList && followSet.length === 0,
    followsNotFound: settled && !contactList,
  };
};
