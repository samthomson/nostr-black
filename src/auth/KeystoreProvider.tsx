import { useCallback, useEffect, useState } from 'react';
import { KeystoreContext } from './keystoreContext';
import { NSecSigner } from '@nostrify/nostrify';
import { lock, unlock, isUnlocked, currentPubkey, getSecretKey } from './keystore';

/**
 * Keystore context: exposes session-key state and the NIP-07-shaped signer
 * built from the in-memory key. One flow, top to bottom: the login UI calls
 * `login(nsec)` → keystore unlocks → consumers see `signer`/`pubkey`.
 * Locking zeroes the key.
 */





export const KeystoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [unlockedState, setUnlockedState] = useState(isUnlocked());
  const [pk, setPk] = useState<string | null>(currentPubkey());

  const login = useCallback((nsec: string): string => {
    const pubkey = unlock(nsec);
    setUnlockedState(true);
    setPk(pubkey);
    return pubkey;
  }, []);

  const logout = useCallback(() => {
    lock();
    setUnlockedState(false);
    setPk(null);
  }, []);

  const rawKey = getSecretKey();
  const signer = unlockedState && rawKey ? new NSecSigner(rawKey) : null;

  useEffect(() => {
    // Safety net: pagehide is the last reliable moment to zero the key.
    const onHide = () => lock();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  return (
    <KeystoreContext.Provider value={{ unlocked: unlockedState, pubkey: pk, login, logout, signer }}>
      {children}
    </KeystoreContext.Provider>
  );
};
