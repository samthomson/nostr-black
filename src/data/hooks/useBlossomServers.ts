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
 * first (BUD-03, `server` tags), `server` tags on their NIP-65 relay
 * list second, and the app's default server as the floor. Upload
 * targets resolve from `servers` in that order — the first declared
 * server is the primary. `declared` / `fromRelayList` expose the two
 * sources separately so the storage settings can edit one without
 * pretending to own the other.
 */
export const useBlossomServers = (): {
  servers: string[];
  /** Servers from the user's kind 10063 — the editable list. */
  declared: string[];
  /** Servers only implied by the NIP-65 relay list — read-only here. */
  fromRelayList: string[];
  /** The kind 10063 event behind `declared`, if one was found. */
  event: NostrEvent | undefined;
  pending: boolean;
} => {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const settle = useEntity(pubkey ? { type: 'blossomServers', pubkey } : undefined, 'background');
  // Subscribe to the relay list too: it may sync after the server-list
  // want settles, and its `server` tags are the second source.
  const relayList = useEntity(pubkey ? { type: 'relayList', pubkey } : undefined, 'background');

  const declared = useMemo(() => serverUrlsOf(settle.event), [settle]);
  const fromRelayList = useMemo(
    () => serverUrlsOf(relayList.event).filter((url) => !declared.includes(url)),
    [relayList, declared],
  );
  const servers = useMemo(() => {
    if (!pubkey) return DEFAULT_BLOSSOM_SERVERS;
    const unique = [...declared, ...fromRelayList];
    return unique.length > 0 ? unique : DEFAULT_BLOSSOM_SERVERS;
  }, [pubkey, declared, fromRelayList]);

  return { servers, declared, fromRelayList, event: settle.event, pending: !!pubkey && isPending(settle) };
};
