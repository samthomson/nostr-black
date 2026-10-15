/**
 * NIP-FB false-bottom envelope: one ciphertext, many recipients, no public
 * identities. See https://github.com/nostr-protocol/nips/pull/2488
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const FB_ALG = 'fb-ecdh-v1';
export const FB_VERSION = 1;

const ZERO32 = new Uint8Array(32);
const INFO_SLOT = utf8ToBytes('fb-slot-v1');
const LABEL_ALIAS = utf8ToBytes('fb-alias-v1');
const LABEL_KIND = utf8ToBytes('fb-kind');
const LABEL_CONN_ADDR = utf8ToBytes('fb-conn-addr-v1');
const LABEL_CONN_KEY = utf8ToBytes('fb-conn-key-v1');
const LABEL_IDENTITY = utf8ToBytes('fb-identity-v1');
const LABEL_NOTE_ID = utf8ToBytes('fb-note-id-v1');

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 32-byte x-coordinate of ECDH(sk, pk), same input NIP-44 uses. */
export const ecdhX = (sk: Uint8Array, pubkeyHex: string): Uint8Array =>
  secp256k1.getSharedSecret(sk, hexToBytes(`02${pubkeyHex}`)).subarray(1, 33);

const hashCat = (...parts: Uint8Array[]): Uint8Array => sha256(concatBytes(...parts));

export const aliasOf = (sk: Uint8Array, peerPk: string): string =>
  bytesToHex(hashCat(ecdhX(sk, peerPk), LABEL_ALIAS));

export const kindTagOf = (sk: Uint8Array, peerPk: string, kind: number): string =>
  bytesToHex(hashCat(ecdhX(sk, peerPk), LABEL_KIND, utf8ToBytes(String(kind))));

export const connAddrOf = (sk: Uint8Array, peerPk: string): string =>
  bytesToHex(hashCat(ecdhX(sk, peerPk), LABEL_CONN_ADDR));

export const derivedIdentityIdOf = (sk: Uint8Array): string =>
  bytesToHex(hashCat(sk, LABEL_IDENTITY));

export const noteIdOf = (replyCek: Uint8Array): string =>
  bytesToHex(hashCat(replyCek, LABEL_NOTE_ID));

/** Shared envelope secret for a pair — must be a valid secp256k1 key. */
export const connKeyOf = (sk: Uint8Array, peerPk: string): Uint8Array => {
  const raw = hashCat(ecdhX(sk, peerPk), LABEL_CONN_KEY);
  secp256k1.getPublicKey(raw, true);
  return raw;
};

const readerKek = (sk: Uint8Array, envelopePk: string): Uint8Array =>
  hkdf(sha256, ecdhX(sk, envelopePk), ZERO32, INFO_SLOT, 32);

const aeadEncrypt = (key: Uint8Array, plain: Uint8Array): string => {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(plain);
  return toB64(concatBytes(nonce, ct));
};

const aeadDecrypt = (key: Uint8Array, packed: string): Uint8Array => {
  const raw = fromB64(packed);
  if (raw.length < 25) throw new Error('fb ciphertext too short');
  return xchacha20poly1305(key, raw.subarray(0, 24)).decrypt(raw.subarray(24));
};

export interface FbEnvelope {
  v: typeof FB_VERSION;
  alg: typeof FB_ALG;
  ct: string;
  slots: string[];
}

const isEnvelope = (value: unknown): value is FbEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1
    && v.alg === FB_ALG
    && typeof v.ct === 'string'
    && Array.isArray(v.slots)
    && v.slots.every((s) => typeof s === 'string');
};

export const parseEnvelope = (content: string): FbEnvelope => {
  const parsed: unknown = JSON.parse(content);
  if (!isEnvelope(parsed)) throw new Error('not an fb envelope');
  return parsed;
};

const wrapCek = (envelopeSk: Uint8Array, readerPk: string, cek: Uint8Array): string =>
  aeadEncrypt(readerKek(envelopeSk, readerPk), cek);

/**
 * The envelope's own secret key, sealed with itself to the author's
 * public key — the nostr `b` tag. ECDH is symmetric, so the author
 * reopens it later with their secret key and the event's public key.
 */
export const sealAuthorKey = (envelopeSk: Uint8Array, authorPk: string): string =>
  aeadEncrypt(readerKek(envelopeSk, authorPk), envelopeSk);

export const openAuthorKey = (sk: Uint8Array, envelopePk: string, packed: string): Uint8Array =>
  aeadDecrypt(readerKek(sk, envelopePk), packed);

/** 1..20 junk slots of the given encoded byte length — random bytes only,
 * never derived from a real slot's contents. */
const junkSlots = (bytes: number): string[] => {
  const extra = 1 + Math.floor(Math.random() * 20);
  return Array.from({ length: extra }, () => toB64(randomBytes(bytes)));
};

export const sealEnvelope = (
  envelopeSk: Uint8Array,
  recipientPks: readonly string[],
  payload: Uint8Array,
  opts: { pad?: boolean; cek?: Uint8Array } = {},
): { envelope: FbEnvelope; cek: Uint8Array } => {
  if (recipientPks.length === 0) throw new Error('fb envelope needs recipients');
  const cek = opts.cek ?? randomBytes(32);
  // One slot per recipient, all interchangeable. The first is only special
  // as the length template junk padding imitates — so every slot, real or
  // junk, looks identical to an outsider.
  const slots = recipientPks.map((pk) => wrapCek(envelopeSk, pk, cek));
  const [template] = slots;
  return {
    cek,
    envelope: {
      v: FB_VERSION,
      alg: FB_ALG,
      ct: aeadEncrypt(cek, payload),
      slots: opts.pad === false ? slots : [...slots, ...junkSlots(fromB64(template!).length)],
    },
  };
};

/** Degenerate envelope: CEK already known (all-viewers replies). */
export const sealSlotless = (cek: Uint8Array, payload: Uint8Array): FbEnvelope => ({
  v: FB_VERSION,
  alg: FB_ALG,
  ct: aeadEncrypt(cek, payload),
  slots: [],
});

/** A revision's envelope: same CEK and slots as the chunk it revises,
 * only the payload re-encrypted. Slot bytes are copied verbatim, so
 * recipients open it exactly as they opened the original. */
export const resealEnvelope = (cek: Uint8Array, payload: Uint8Array, slots: string[]): FbEnvelope => ({
  v: FB_VERSION,
  alg: FB_ALG,
  ct: aeadEncrypt(cek, payload),
  slots,
});
export const openEnvelope = (sk: Uint8Array, envelopePk: string, envelope: FbEnvelope): Uint8Array =>
  openEnvelopeWithCek(sk, envelopePk, envelope).payload;

export const openEnvelopeWithCek = (
  sk: Uint8Array,
  envelopePk: string,
  envelope: FbEnvelope,
): { payload: Uint8Array; cek: Uint8Array } => {
  if (envelope.slots.length === 0) {
    throw new Error('slotless envelope — application must supply the cek');
  }
  const kek = readerKek(sk, envelopePk);
  let cek: Uint8Array | undefined;
  for (const slot of envelope.slots) {
    try {
      cek = aeadDecrypt(kek, slot);
      break;
    } catch {
      // junk or another recipient's slot
    }
  }
  if (!cek) throw new Error('not a recipient');
  return { cek, payload: aeadDecrypt(cek, envelope.ct) };
};

/** The plaintext behind `ct`, given the CEK — for layer inspection. */
export const decryptCt = (cek: Uint8Array, ct: string): Uint8Array =>
  aeadDecrypt(cek, ct);

export const openSlotless = (cek: Uint8Array, envelope: FbEnvelope): Uint8Array => {
  if (envelope.slots.length !== 0) throw new Error('expected slotless envelope');
  return aeadDecrypt(cek, envelope.ct);
};

export const encodeEnvelope = (envelope: FbEnvelope): string => JSON.stringify(envelope);
