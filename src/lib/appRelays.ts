import type { AppConfig } from '@/contexts/AppContext';

/**
 * Discovery relays — hardcoded defaults for `config.discoveryRelays` (the
 * app's own relays). User relays are NEVER hardcoded: they are fetched from
 * the user's NIP-65 kind 10002 after login (NostrSync). Discovery relays are
 * queried ONLY to find the logged-in user's own kind 10002 / kind 3 — never
 * for feed content. Editable in settings.
 */
export const DEFAULT_DISCOVERY_RELAYS = [
  'wss://relay.samt.st/',
  'wss://bruh.samt.st/',
  'wss://testnet.samt.st/',
];

/**
 * Relays to READ from: the user's fetched NIP-65 read relays, falling back
 * to the discovery defaults until their list has been fetched.
 */
export const readRelays = (config: AppConfig): string[] => {
  const user = config.relayMetadata.relays.filter((r) => r.read).map((r) => r.url);
  return user.length > 0 ? user : config.discoveryRelays;
};

/**
 * Relays to WRITE to: the user's fetched NIP-65 write relays, falling back
 * to the discovery defaults until their list has been fetched.
 */
export const writeRelays = (config: AppConfig): string[] => {
  const user = config.relayMetadata.relays.filter((r) => r.write).map((r) => r.url);
  return user.length > 0 ? user : config.discoveryRelays;
};
