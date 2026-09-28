import { useQuery } from '@tanstack/react-query';
import { NSchema as n } from '@nostrify/nostrify';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useNostrLogin } from '@nostrify/react/login';
import { readRelays } from '@/lib/appRelays';
import { useAppContext } from '@/hooks/useAppContext';
import { queryRelays } from '@/net/net';

export interface Account {
  id: string;
  pubkey: string;
  event?: NostrEvent;
  metadata: NostrMetadata;
}

export function useLoggedInAccounts() {
  const { logins, setLogin, removeLogin } = useNostrLogin();
  const { config } = useAppContext();

  const { data: authors = [], isLoading } = useQuery({
    queryKey: ['nostr', 'logins', logins.map((l) => l.id).join(';')],
    enabled: logins.length > 0,
    queryFn: async (c) => {
      const events = await queryRelays(
        readRelays(config),
        [{ kinds: [0], authors: logins.map((l) => l.pubkey) }],
        { signal: c.signal },
      );

      return logins.map(({ id, pubkey }): Account => {
        const event = events.find((e) => e.pubkey === pubkey);
        try {
          const metadata = n.json().pipe(n.metadata()).parse(event?.content);
          return { id, pubkey, metadata, event };
        } catch {
          return { id, pubkey, metadata: {}, event };
        }
      });
    },
    retry: 3,
  });

  // Current user is the first login
  const currentUser: Account | undefined = (() => {
    const login = logins[0];
    if (!login) return undefined;
    const author = authors.find((a) => a.id === login.id);
    return { metadata: {}, ...author, id: login.id, pubkey: login.pubkey };
  })();

  // Other users are all logins except the current one
  const otherUsers = (authors || []).slice(1) as Account[];

  return {
    authors,
    currentUser,
    otherUsers,
    isLoading,
    setLogin,
    removeLogin,
  };
}
