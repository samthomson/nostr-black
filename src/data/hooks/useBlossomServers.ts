import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isPending, useEntity } from './useEntity';
import { DEFAULT_BLOSSOM_SERVERS } from '@/lib/appRelays';


/** https origins of an event's `server` tags; junk skipped, deduped. */
const serverUrlsOf = (event: NostrEvent | undefined): string[] => {
  if (!event) return [];
  const urls: string[] = [];
  for (const [name, value] of event.tags) {
    if (name !== 'server' || !value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') continue;
      urls.push(url.origin);
    } catch {
      // malformed server tag — skip it
    }
  }
  return [...new Set(urls)];
};

/**
 * The logged-in user's blossom upload servers: their kind 10063 list
 * first, `server` tags on their NIP-65 list second, and the app's
 * default server as the floor — the same shape as the discovery-relay
 * fallback. Upload targets resolve from this; `pending` tells the UI the
 * 10063 sync is still in flight (a fallback here is a default, not a
 * verdict that the user has no list).
 */
export const useBlossomServers = (): { servers: string[]; pending: boolean } => {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const settle = useEntity(pubkey ? { type: 'blossomServers', pubkey } : undefined, 'background');
  // Subscribe to the relay list too: it may sync after the server-list
  // want settles, and its `server` tags are the second source.
  const relayList = useEntity(pubkey ? { type: 'relayList', pubkey } : undefined, 'background');

  const servers = useMemo(() => {
    if (!pubkey) return DEFAULT_BLOSSOM_SERVERS;
    const declared = [
      ...serverUrlsOf(settle.event),
      ...serverUrlsOf(relayList.event),
    ];
    const unique = [...new Set(declared)];
    return unique.length > 0 ? unique : DEFAULT_BLOSSOM_SERVERS;
  }, [pubkey, settle, relayList]);

  return { servers, pending: !!pubkey && isPending(settle) };
};
