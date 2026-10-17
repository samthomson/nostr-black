import { createContext } from 'react';

/** NIP-65 relay list synced from the user's kind 10002. */
export interface RelayMetadata {
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of the winning event; 0 = not synced. */
  updatedAt: number;
}

/** Follow list synced from the user's kind 3 (NIP-02). */
export interface FollowState {
  pubkeys: string[];
  /** created_at of the winning kind 3 event; 0 = not synced yet. */
  updatedAt: number;
}

/**
 * User nostr state — data synced from relays for the logged-in user
 * (relay list, follows). Distinct from AppConfig (app settings like theme,
 * discovery relays, tor/media preferences): this is the user's data, not
 * the app's configuration. Persisted separately; relay failures can never
 * blank it — only newer synced data replaces it.
 */
export interface UserState {
  relayMetadata: RelayMetadata;
  follows: FollowState;
}

export interface UserStateContextType {
  state: UserState;
  updateUser: (updater: (current: UserState) => UserState) => void;
  /** Runtime (non-persisted) epoch-ms of the last completed sync attempt. */
  relaySyncedAt?: number;
  markRelaySynced: () => void;
  /** Bumped by the settings "resync" button; the sync effect re-runs. */
  relaySyncNonce: number;
  bumpRelaySync: () => void;
}

export const UserStateContext = createContext<UserStateContextType | undefined>(undefined);
