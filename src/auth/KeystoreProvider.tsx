import { useCallback, useState } from 'react';
import { KeystoreContext } from './keystoreContext';
import { NSecSigner } from '@nostrify/nostrify';
import { flushSession, lock, unlock, isUnlocked, currentPubkey, getSecretKey, storedSession } from './keystore';

/**
 * Keystore context: exposes session-key state and the NIP-07-shaped signer
 * built from the in-memory key. One flow, top to bottom: the login UI
 * calls `login(nsec)` → keystore unlocks and remembers → consumers see
 * `signer`/`pubkey`. A remembered key re-unlocks on boot, so reloads keep
 * you logged in; `logout` flushes the stored nsec entirely.
 */

const bootFromStorage = (): void => {
  const stored = storedSession();
  if (!stored) return;
  try {
    unlock(stored);
  } catch {
    flushSession();
  }
};

export const KeystoreProvider = ({ children }: { children: React.ReactNode }) => {
  useState(bootFromStorage); // re-unlock a remembered key before first paint
  const [unlockedState, setUnlockedState] = useState(isUnlocked);
  const [pk, setPk] = useState<string | null>(currentPubkey);

  const login = useCallback((nsec: string): string => {
    const pubkey = unlock(nsec);
    setUnlockedState(true);
    setPk(pubkey);
    return pubkey;
  }, []);

  const logout = useCallback(() => {
    flushSession();
    lock();
    setUnlockedState(false);
    setPk(null);
  }, []);

  const rawKey = getSecretKey();
  const signer = unlockedState && rawKey ? new NSecSigner(rawKey) : null;

  return (
    <KeystoreContext.Provider value={{ unlocked: unlockedState, pubkey: pk, login, logout, signer }}>
      {children}
    </KeystoreContext.Provider>
  );
};
