import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { queryRelay, queryRelays } from '@/net/net';
import { useAppContext } from './useAppContext';
import { useUserState } from './useUserState';
import { readRelays } from '@/lib/appRelays';
import { buildAuthorRelayMap, parseRelayList } from '@/lib/outbox';

/**
 * Profile data via the outbox model: where an author publishes (their kind
 * 10002) and who they are (kind 0 on those relays, falling back to ours).
 */

export function useProfileRelays(pubkey: string | undefined) {
  const { config } = useAppContext();
  const { state: userState } = useUserState();
  return useQuery({
    queryKey: ['profile', 'relays', pubkey],
    enabled: !!pubkey,
    queryFn: async (c) => {
      const events = await queryRelays(
        readRelays(userState, config),
        [{ kinds: [10002], authors: [pubkey!], limit: 1 }],
        { signal: c.signal },
      );
      return buildAuthorRelayMap(events).get(pubkey!) ?? parseRelayList(undefined);
    },
  });
}

export function useProfileMetadata(pubkey: string | undefined, writeRelays: string[]) {
  const { config } = useAppContext();
  const { state: userState } = useUserState();
  return useQuery({
    queryKey: ['profile', 'metadata', pubkey, writeRelays.join(',')],
    enabled: !!pubkey,
    queryFn: async (c): Promise<NostrMetadata | undefined> => {
      // kind 0 lives on the author's relays; fall back to ours.
      const own = writeRelays.length > 0
        ? await queryRelays(writeRelays, [{ kinds: [0], authors: [pubkey!], limit: 1 }], { signal: c.signal })
        : [];
      const events = own.length > 0
        ? own
        : await queryRelays(readRelays(userState, config), [{ kinds: [0], authors: [pubkey!], limit: 1 }], { signal: c.signal });
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return undefined;
      try {
        return JSON.parse(latest.content) as NostrMetadata;
      } catch {
        return undefined;
      }
    },
  });
}

/** The author's own notes, from the relays they declared (outbox). */
export function useProfileNotes(pubkey: string | undefined, writeRelays: string[], kinds: number[], limit: number) {
  return useQuery({
    queryKey: ['profile', 'notes', pubkey, writeRelays.join(',')],
    enabled: writeRelays.length > 0,
    queryFn: async (c): Promise<NostrEvent[]> => {
      const results = await Promise.all(
        writeRelays.map((url) =>
          queryRelay(url, [{ kinds, authors: [pubkey!], limit }], { signal: c.signal })),
      );
      return [...new Map(results.flat().map((e) => [e.id, e])).values()]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
    },
  });
}

/** Fetch one event by id, trying relay hints in order (NIP-19 pointers). */
export function useEventFetch(id: string | undefined, relays: string[]) {
  return useQuery({
    queryKey: ['event', id, relays.join(',')],
    enabled: !!id,
    queryFn: async (c): Promise<NostrEvent | null> => {
      for (const url of relays) {
        const events = await queryRelay(url, [{ ids: [id!] }], { signal: c.signal });
        if (events.length > 0) return events[0];
      }
      return null;
    },
  });
}
