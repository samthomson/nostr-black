import { ReactNode, useCallback, useMemo, useState } from 'react';
import { UserStateContext, type UserState } from '@/contexts/UserStateContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useKeystore } from '@/auth/useKeystore';

const EMPTY_STATE: UserState = {
  relayMetadata: { relays: [], updatedAt: 0 },
  follows: { pubkeys: [], updatedAt: 0 },
};

/** Persisted shape: state per pubkey — switching identities must never
 * leak one account's follows or relay list into another's queries. */
type Stored = Partial<Record<string, Partial<UserState>>>;

interface UserStateProviderProps {
  children: ReactNode;
  storageKey: string;
  /** Test seam: seed state without syncing from relays. */
  initialState?: Partial<UserState>;
}

/**
 * Owns synced user nostr state (relay list, follows), persisted per
 * identity: `storageKey` holds a pubkey → state map, and only the active
 * pubkey's entry is read or written. All writes go through updateUser;
 * sync effects compare `updatedAt` so only newer relay data ever
 * replaces stored data.
 */
export function UserStateProvider(props: UserStateProviderProps) {
  const { children, storageKey, initialState } = props;
  const { pubkey } = useKeystore();

  const [stored, setStored] = useLocalStorage<Stored>(storageKey, {});

  const updateUser = useCallback(
    (updater: (current: UserState) => UserState) => {
      if (!pubkey) return;
      setStored((current) => ({
        ...current,
        [pubkey]: updater({ ...EMPTY_STATE, ...current[pubkey] }),
      }));
    },
    [pubkey, setStored],
  );

  const state = useMemo<UserState>(
    // initialState (test seed) wins over stored — the seed is the scenario.
    () => ({ ...EMPTY_STATE, ...(pubkey ? stored[pubkey] : undefined), ...initialState }),
    [stored, pubkey, initialState],
  );

  const [relaySyncedAt, setRelaySyncedAt] = useState<number | undefined>(undefined);
  const markRelaySynced = useCallback(() => setRelaySyncedAt(Date.now()), []);
  const [relaySyncNonce, setRelaySyncNonce] = useState(0);
  const bumpRelaySync = useCallback(() => setRelaySyncNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({ state, updateUser, relaySyncedAt, markRelaySynced, relaySyncNonce, bumpRelaySync }),
    [state, updateUser, relaySyncedAt, markRelaySynced, relaySyncNonce, bumpRelaySync],
  );

  return <UserStateContext.Provider value={value}>{children}</UserStateContext.Provider>;
}
