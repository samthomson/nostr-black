import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { queryRelay, queryRelays } from '@/net/net';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { readRelays } from '@/lib/appRelays';
import { buildAuthorRelayMap } from '@/lib/outbox';

/**
 * Fetches one event by id, best-guess-first:
 *   1. relay hints (NIP-10 e-tag third element, or where the child event was
 *      found — a reply usually lives on the same relays as its parent)
 *   2. the app's read relays
 *   3. (when the author is known) the author's declared write relays
 */
export const useEventById = (
  id: string | undefined,
  author?: string,
  hintRelays: string[] = [],
) => {
  const { config } = useAppContext();
  const { state: userState } = useUserState();
  const hints = [...new Set(hintRelays.filter((u) => /^wss?:\/\//.test(u)))];

  return useQuery({
    queryKey: ['event-by-id', id, author ?? null, hints.join(',')],
    enabled: !!id,
    queryFn: async (): Promise<NostrEvent | null> => {
      for (const url of hints) {
        const events = await queryRelay(url, [{ ids: [id!] }]);
        if (events.length > 0) return events[0];
      }

      const direct = await queryRelays(readRelays(userState, config), [{ ids: [id!] }]);
      if (direct.length > 0) {
        return direct.sort((a, b) => b.created_at - a.created_at)[0];
      }

      if (author) {
        const lists = await queryRelays(
          readRelays(userState, config),
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
