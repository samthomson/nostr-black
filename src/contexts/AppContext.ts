import { createContext } from "react";

export type Theme = "dark" | "light" | "system";


export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** Discovery relays: where the user's own lists are looked up (never for
   * feed content). User-editable; defaults to DEFAULT_DISCOVERY_RELAYS. */
  discoveryRelays: string[];
  /** Desktop only: route egress through Tor (default) or connect directly
   * (faster; for users whose anonymity comes from a VPN). Ignored on web. */
  torEnabled: boolean;
  /** Render images and video in the feed (default on). */
  mediaEnabled: boolean;
  /** Desktop only: media cache budget in MB. */
  mediaCacheMaxMb: number;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
