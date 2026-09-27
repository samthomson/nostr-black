import { type NLoginType, NUser, useNostrLogin } from '@nostrify/react/login';
import { useNostr } from '@nostrify/react';
import { useCallback, useMemo } from 'react';

import { useAuthor } from './useAuthor.ts';
import { useKeystore } from '@/auth/useKeystore';
import { keystoreUser } from '@/auth/keystoreUser';

export function useCurrentUser() {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const keystore = useKeystore();

  const loginToUser = useCallback((login: NLoginType): NUser  => {
    switch (login.type) {
      case 'bunker': // Nostr login with NIP-46 "bunker://" URI
        return NUser.fromBunkerLogin(login, nostr);
      case 'extension': // Nostr login with NIP-07 browser extension
        return NUser.fromExtensionLogin(login);
      // Persisted nsec logins are deliberately unsupported — the memory-only
      // keystore is the sole sanctioned local-key path.
      default:
        throw new Error(`Unsupported login type: ${login.type}`);
    }
  }, [nostr]);

  const persistedUsers = useMemo(() => {
    const users: NUser[] = [];

    for (const login of logins) {
      try {
        users.push(loginToUser(login));
      } catch (error) {
        console.warn('Skipped invalid login', login.id, error);
      }
    }

    return users;
  }, [logins, loginToUser]);

  // The memory-only keystore session takes precedence over persisted logins:
  // unlocking a key is an explicit "this is who I am now" action.
  const keystoreSessionUser = useMemo(
    () => (keystore.unlocked && keystore.signer && keystore.pubkey
      ? keystoreUser(keystore.pubkey, keystore.signer)
      : undefined),
    [keystore.unlocked, keystore.signer, keystore.pubkey],
  );

  const users = useMemo(
    () => (keystoreSessionUser ? [keystoreSessionUser, ...persistedUsers] : persistedUsers),
    [keystoreSessionUser, persistedUsers],
  );

  const user = users[0] as NUser | undefined;
  const author = useAuthor(user?.pubkey);

  return {
    user,
    users,
    ...author.data,
  };
}
