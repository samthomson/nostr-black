import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { store } from '@/data/store';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isPending, useEntity } from './useEntity';
import { DEFAULT_BLOSSOM_SERVERS } from '@/lib/appRelays';

/** NIP-65 relay list — some clients declare `server` tags here too. */
const KIND_RELAY_LIST = 10002;

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
 * The logged-in user's blossom upload servers: their kind 10006 list
 * first, `server` tags on their NIP-65 list second, and the app's
 * default server as the floor — the same shape as the discovery-relay
 * fallback. Upload targets resolve from this; `pending` tells the UI the
 * 10006 sync is still in flight (a fallback here is a default, not a
 * verdict that the user has no list).
 */
export const useBlossomServers = (): { servers: string[]; pending: boolean } => {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const settle = useEntity(pubkey ? { type: 'blossomServers', pubkey } : undefined, 'background');

  const servers = useMemo(() => {
    if (!pubkey) return DEFAULT_BLOSSOM_SERVERS;
    const declared = [
      ...serverUrlsOf(settle.event),
      ...serverUrlsOf(store.getReplaceable(KIND_RELAY_LIST, pubkey)),
    ];
    const unique = [...new Set(declared)];
    return unique.length > 0 ? unique : DEFAULT_BLOSSOM_SERVERS;
  }, [pubkey, settle]);

  return { servers, pending: !!pubkey && isPending(settle) };
};
