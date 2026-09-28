import { ReactNode, useCallback, useMemo, useState } from 'react';
import { UserStateContext, type UserState } from '@/contexts/UserStateContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';

const EMPTY_STATE: UserState = {
  relayMetadata: { relays: [], updatedAt: 0 },
  follows: { pubkeys: [], updatedAt: 0 },
};

interface UserStateProviderProps {
  children: ReactNode;
  storageKey: string;
  /** Test seam: seed state without syncing from relays. */
  initialState?: Partial<UserState>;
}

/**
 * Owns synced user nostr state (relay list, follows), persisted separately
 * from app config. All writes go through updateUser; sync effects compare
 * `updatedAt` so only newer relay data ever replaces stored data.
 */
export function UserStateProvider(props: UserStateProviderProps) {
  const { children, storageKey, initialState } = props;

  const [stored, setStored] = useLocalStorage<Partial<UserState>>(storageKey, {});

  const updateUser = useCallback(
    (updater: (current: UserState) => UserState) => {
      setStored((current) => updater({ ...EMPTY_STATE, ...current }));
    },
    [setStored],
  );

  const state = useMemo<UserState>(
    // initialState (test seed) wins over stored — the seed is the scenario.
    () => ({ ...EMPTY_STATE, ...stored, ...initialState }),
    [stored, initialState],
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
