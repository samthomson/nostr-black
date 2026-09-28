import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { queryRelays } from '@/net/net';
import { readRelays } from '@/lib/appRelays';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';

/** Fetches kind-0 metadata for a pubkey via the unified transport. */
export function useAuthor(pubkey: string | undefined) {
  const { config } = useAppContext();
  const { state: userState } = useUserState();
  return useQuery({
    queryKey: ['author', pubkey],
    enabled: !!pubkey,
    queryFn: async (c) => {
      const events = await queryRelays(
        readRelays(userState, config),
        [{ kinds: [0], authors: [pubkey!], limit: 3 }],
      ).catch(() => [] as NostrEvent[]);
      void c;
      return events;
    },
    select: (events: NostrEvent[]) => {
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return { metadata: undefined, event: undefined };
      try {
        return { metadata: JSON.parse(latest.content), event: latest };
      } catch {
        return { metadata: undefined, event: latest };
      }
    },
  });
}

void nip19;
