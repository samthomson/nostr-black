import { nip19, getPublicKey } from 'nostr-tools';
/**
 * The key store. THE only module in the app that ever holds key
 * material (see AGENTS.md privacy doctrine).
 *
 * The nsec is kept in localStorage so sessions survive reloads; logout
 * flushes it. In memory it lives in a closure variable and dies with the
 * tab. Callers get capabilities (sign/encrypt via the signer they build
 * from `getSecretKey()`), never a stored copy elsewhere.
 */

const STORAGE_KEY = 'keystore.nsec';

let secretKey: Uint8Array | null = null;
let pubkey: string | null = null;

/** Is a key unlocked for this session? */
export const isUnlocked = (): boolean => secretKey !== null;

/** Pubkey of the unlocked key, or null. */
export const currentPubkey = (): string | null => pubkey;

/** The persisted nsec, if this device remembers one. */
export const storedSession = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Drop the persisted nsec — logout. */
export const flushSession = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was ever persisted.
  }
};

/** Unlock with an nsec (or hex) key and remember it across reloads.
 * Throws on garbage. Zeroes any prior key. */
export const unlock = (nsecOrHex: string): string => {
  const next = decodeKey(nsecOrHex);
  lock();
  secretKey = next;
  pubkey = getPublicKey(next);
  try {
    localStorage.setItem(STORAGE_KEY, nsecOrHex.trim());
  } catch {
    // Storage unavailable: session-only login.
  }
  return pubkey;
};

/** Zero the key and drop it from memory. Idempotent. Keeps the stored
 * nsec — use flushSession to forget the device. */
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
