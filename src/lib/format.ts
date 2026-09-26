import { nip19 } from 'nostr-tools';

/** The union result of nip19.decode — named for consumers. */
export type DecodeResult = ReturnType<typeof nip19.decode>;
/** Route href for a pubkey profile; undefined if unencodable (untrusted data). */
export const profileHref = (pubkey: string): string | undefined => {
  try {
    return `/${nip19.npubEncode(pubkey)}`;
  } catch {
    return undefined;
  }
};

/** Route href for an event (nevent, falling back to note); undefined if unencodable. */
export const eventHref = (id: string, author: string): string | undefined => {
  try {
    return `/${nip19.neventEncode({ id, author, relays: [] })}`;
  } catch {
    // fall through — malformed ids are untrusted relay data
  }
  try {
    return `/${nip19.noteEncode(id)}`;
  } catch {
    return undefined;
  }
};

/** npub for a pubkey, or the raw input if unencodable. */
export const npubOf = (pubkey: string): string => {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
};

/** Hostname of a url, or the raw string if unparseable. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Short `aaaa…bbbb` form for long hex strings. */
export const shortHex = (hex: string): string => `${hex.slice(0, 8)}…${hex.slice(-4)}`;

/**
 * Feed timestamp: relative, plus absolute for context.
 *   "42s · 8:21pm" (today) — "3h · 8:21pm" — "2d · Tue 5:04pm" — "3w · 12 Mar"
 */
export const formatTimestamp = (createdAt: number, now = Date.now() / 1000): string => {
  const seconds = Math.max(0, Math.floor(now - createdAt));
  const relative =
    seconds < 60 ? `${seconds}s`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h`
    : seconds < 7 * 86400 ? `${Math.floor(seconds / 86400)}d`
    : `${Math.floor(seconds / (7 * 86400))}w`;

  const date = new Date(createdAt * 1000);
  const time = date
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '');
  const sameDay = new Date(now * 1000).toDateString() === date.toDateString();

  if (sameDay) return `${relative} · ${time}`;
  if (seconds < 7 * 86400) {
    const day = date.toLocaleDateString([], { weekday: 'short' });
    return `${relative} · ${day} ${time}`;
  }
  return `${relative} · ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
};
