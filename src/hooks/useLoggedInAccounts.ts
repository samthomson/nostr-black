import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useNostrLogin } from '@nostrify/react/login';
import { useProfiles } from '@/data/hooks/useProfile';

export interface Account {
  id: string;
  pubkey: string;
  event?: NostrEvent;
  metadata: NostrMetadata;
}

/**
 * The persisted logins, each with their kind 0. The metadata comes from the
 * store, so switching accounts shows a profile the feed or a note already
 * resolved rather than refetching it under a different cache key.
 */
export function useLoggedInAccounts() {
  const { logins, setLogin, removeLogin } = useNostrLogin();
  const profiles = useProfiles(logins.map((l) => l.pubkey));

  const authors: Account[] = logins.map(({ id, pubkey }) => {
    const profile = profiles.get(pubkey);
    return { id, pubkey, event: profile?.event, metadata: profile?.metadata ?? {} };
  });

  return {
    authors,
    currentUser: authors[0],
    otherUsers: authors.slice(1),
    isLoading: [...profiles.values()].some((p) => p.pending),
    setLogin,
    removeLogin,
  };
}
