import { createContext } from 'react';
import type { NSecSigner } from '@nostrify/nostrify';

export interface KeystoreContextType {
  unlocked: boolean;
  pubkey: string | null;
  /** Unlock with an nsec; throws on invalid input. */
  login: (nsec: string) => string;
  /** Zero the key and end the session. */
  logout: () => void;
  /** NIP-07 interface signer backed by the in-memory key (null when locked). */
  signer: NSecSigner | null;
}

export const KeystoreContext = createContext<KeystoreContextType | undefined>(undefined);
