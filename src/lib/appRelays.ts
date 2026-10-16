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
  'wss://relay.primal.net/',
  'wss://relay.ditto.pub/',
];

/**
 * The canonical form of a relay url typed by a user: parsed and serialised
 * by the URL parser (lowercases scheme and host, drops the default port,
 * pins the origin path to exactly one slash), no query or fragment.
 * Returns undefined for anything that is not a bare ws(s) url — double
 * protocols, empty hosts, http links, pasted junk.
 */
export const normalizeRelayUrl = (input: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return undefined;
  if (!url.hostname) return undefined;
  // A pasted `wss://wss://relay/` parses as host "wss" with a `//…` path —
  // no relay lives on a double-slash path.
  if (url.pathname.startsWith('//')) return undefined;
  if (url.search || url.hash) return undefined;
  if (url.pathname === '') url.pathname = '/';
  return url.toString();
};
