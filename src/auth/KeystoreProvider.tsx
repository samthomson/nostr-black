import { useCallback, useState } from 'react';
import { KeystoreContext } from './keystoreContext';
import { NSecSigner } from '@nostrify/nostrify';
import { flushSession, lock, unlock, isUnlocked, currentPubkey, getSecretKey, storedSession } from './keystore';
import { flushBurners } from './burners';
import { store } from '@/data/store';
import { scheduler } from '@/data/scheduler';
import { persister } from '@/data/persist/persist';

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

  // Identity is the cache key. Switching or dropping the key drops all
  // fetched data with it — one identity must never see another's store.
  // The identity is captured by the caller BEFORE lock()/unlock()
  // zeroes the keystore: read here instead, and logout would flush no
  // one (null after lock) while an identity switch would flush the new
  // identity's burners.
  const wipeData = (identity: string | null): void => {
    void persister.wipe();
    store.clear();
    scheduler.invalidate();
    if (identity) flushBurners(identity);
  };

  const login = useCallback((nsec: string): string => {
    const previous = currentPubkey();
    const pubkey = unlock(nsec);
    if (previous !== null && previous !== pubkey) wipeData(previous);
    setUnlockedState(true);
    setPk(pubkey);
    return pubkey;
  }, []);

  const logout = useCallback(() => {
    const identity = currentPubkey();
    flushSession();
    lock();
    wipeData(identity);
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
