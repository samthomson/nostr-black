/**
 * Discovery relays — hardcoded defaults for `config.discoveryRelays` (the
 * app's own relays). User relays are NEVER hardcoded: they are fetched from
 * the user's NIP-65 kind 10002 after login (NostrSync). Discovery relays are
 * queried ONLY to find the logged-in user's own kind 10002 / kind 3 — never
 * for feed content. Editable in settings.
 */
export const DEFAULT_DISCOVERY_RELAYS = [
  'wss://relay.nostr.black/',
  'wss://relay.samt.st/',
  'wss://bruh.samt.st/',
  'wss://testnet.samt.st/',
];
