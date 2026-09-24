import type { RelayMetadata } from '@/contexts/AppContext';

/**
 * App default relays. Used as the initial `relayMetadata` for new users and as
 * a fallback when the user has no NIP-65 relay list configured (e.g. during
 * nostrconnect handshakes before any user relays have been loaded).
 */
export const APP_RELAYS: RelayMetadata = {
  relays: [
    { url: 'wss://relay.samt.st/', read: true, write: true },
    { url: 'wss://bruh.samt.st/', read: true, write: true },
    { url: 'wss://testnet.samt.st/', read: true, write: true },
  ],
  updatedAt: 0,
};
