import { useMemo } from 'react';

import { useKeystore } from '@/auth/useKeystore';
import { keystoreUser } from '@/auth/keystoreUser';

/** The current user is the keystore session — login is nsec-only. */
export function useCurrentUser() {
  const keystore = useKeystore();

  const user = useMemo(
    () => (keystore.unlocked && keystore.signer && keystore.pubkey
      ? keystoreUser(keystore.pubkey, keystore.signer)
      : undefined),
    [keystore.unlocked, keystore.signer, keystore.pubkey],
  );

  // Identity only. Whoever needs the current user's kind 0 asks the store
  // for it with `useProfile` — the same entity everyone else reads.
  return { user, users: user ? [user] : [] };
}
