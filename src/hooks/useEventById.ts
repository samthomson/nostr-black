import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { queryRelay, queryRelays } from '@/net/relayClient';
import { useAppContext } from '@/hooks/useAppContext';
import { readRelays } from '@/lib/appRelays';
import { buildAuthorRelayMap } from '@/lib/outbox';

/**
 * Fetches one event by id. Looks on the app's read relays, then (when an
 * author pubkey is known) on that author's declared write relays — where
 * their events actually live.
 */
export const useEventById = (id: string | undefined, author?: string) => {
  const { config } = useAppContext();

  return useQuery({
    queryKey: ['event-by-id', id, author ?? null],
    enabled: !!id,
    queryFn: async (): Promise<NostrEvent | null> => {
      const direct = await queryRelays(readRelays(config), [{ ids: [id!] }]);
      if (direct.length > 0) {
        return direct.sort((a, b) => b.created_at - a.created_at)[0];
      }

      if (author) {
        const lists = await queryRelays(
          readRelays(config),
          [{ kinds: [10002], authors: [author], limit: 1 }],
        );
        const write = buildAuthorRelayMap(lists).get(author)?.write ?? [];
        for (const url of write) {
          const events = await queryRelay(url, [{ ids: [id!] }]);
          if (events.length > 0) return events[0];
        }
      }
      return null;
    },
  });
};
