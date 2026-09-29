import { nip19, getPublicKey } from 'nostr-tools';
/**
 * Memory-only key store. THE only module in the app that ever holds key
 * material (see AGENTS.md privacy doctrine). Nothing is persisted — the key
 * lives in a closure variable for the session and dies with the tab/app.
 *
 * Callers get capabilities (sign/encrypt via the signer they build from
 * `getSecretKey()`), never a stored copy elsewhere.
 */

let secretKey: Uint8Array | null = null;
let pubkey: string | null = null;

/** Is a key unlocked for this session? */
export const isUnlocked = (): boolean => secretKey !== null;

/** Pubkey of the unlocked key, or null. */
export const currentPubkey = (): string | null => pubkey;

/** Unlock with an nsec (or hex) key. Throws on garbage. Zeroes any prior key. */
export const unlock = (nsecOrHex: string): string => {
  const next = decodeKey(nsecOrHex);
  lock();
  secretKey = next;
  pubkey = getPublicKey(next);
  return pubkey;
};

/** Zero the key and drop it. Idempotent. */
export const lock = (): void => {
  if (secretKey) secretKey.fill(0);
  secretKey = null;
  pubkey = null;
};

/**
 * The raw session key, for crypto that must run in JS (private-feed NIP).
 * This is the ONE sanctioned escape hatch — do not add others.
 */
export const getSecretKey = (): Uint8Array | null => secretKey;

const decodeKey = (input: string): Uint8Array => {
  const trimmed = input.trim();
  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('not an nsec');
    return decoded.data as Uint8Array;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Uint8Array.from(trimmed.match(/../g)!.map((b) => parseInt(b, 16)));
  }
  throw new Error('enter an nsec1… key');
};
