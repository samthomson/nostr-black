import { createContext } from "react";

export type Theme = "dark" | "light" | "system";

export interface RelayMetadata {
  /** List of relays with read/write permissions */
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of when the relay list was last updated */
  updatedAt: number;
}


export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** NIP-65 relay list metadata */
  relayMetadata: RelayMetadata;
  /** Discovery relays: where the user's own lists are looked up (never for
   * feed content). User-editable; defaults to DEFAULT_DISCOVERY_RELAYS. */
  discoveryRelays: string[];
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
  /** Runtime (non-persisted) epoch-ms of the last completed NIP-65 discovery
   * attempt — lets consumers distinguish "not found" from "still searching". */
  relaySyncedAt?: number;
  markRelaySynced: () => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
