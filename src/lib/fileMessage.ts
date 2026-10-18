/**
 * Private-note media attachments, PR-#2437 shape (nips PR 2437 — kind
 * 15's encryption properties as imeta fields): bytes encrypted with
 * AES-256-GCM under the conversation's reply CEK — the same key that
 * seals the conversation, written into `decryption-key` per the field's
 * meaning — ciphertext uploaded to a blossom server, referenced by an
 * `imeta` tag on the kind-1 rumor. One key opens the conversation and
 * everything in it; nobody else gets bytes.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { getEventHash } from 'nostr-tools';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { makeRumor, type Rumor } from './feedEncryption';
import { blossomBytes } from '@/net/blossom';

export const FILE_ENCRYPTION = 'aes-gcm';

export interface EncryptedImage {
  ct: Uint8Array;
  /** sha256 of the ciphertext — the blossom blob id (imeta `x`). */
  x: string;
  /** sha256 of the plaintext (imeta `ox`). */
  ox: string;
  /** GCM nonce, hex — unique per image under the shared key. */
  nonce: string;
}

export const encryptImage = (replyCek: Uint8Array, bytes: Uint8Array): EncryptedImage => {
  const nonce = randomBytes(12);
  const ct = gcm(replyCek, nonce).encrypt(bytes);
  return {
    ct,
    x: bytesToHex(sha256(ct)),
    ox: bytesToHex(sha256(bytes)),
    nonce: bytesToHex(nonce),
  };
};

export const decryptImage = (keyHex: string, nonceHex: string, ct: Uint8Array): Uint8Array =>
  gcm(hexToBytes(keyHex), hexToBytes(nonceHex)).decrypt(ct);

/** Mint a fresh conversation — rumor shell plus its reply CEK — before
 * the images are encrypted: they need the key. post fills content and
 * media tags on top of this shell at submit. */
export const mintConversation = (authorPk: string): { rumor: Rumor; replyCek: Uint8Array } =>
  makeRumor(authorPk, '');

/** A rumor with fields replaced, its id recomputed — the minted
 * conversation gains its content and media tags this way. */
export const remintRumor = (
  rumor: Rumor,
  changes: Partial<Pick<Rumor, 'content' | 'tags'>>,
): Rumor => {
  const next = { ...rumor, ...changes };
  return {
    ...next,
    id: getEventHash({
      pubkey: next.pubkey,
      created_at: next.created_at,
      kind: next.kind,
      tags: next.tags,
      content: next.content,
    }),
  };
};

/** One staged image, url included once the confirmed upload returned
 * it. The decryption key is the conversation's CEK, hex. */
export interface UploadedImage {
  url: string;
  mime: string;
  x: string;
  ox: string;
  nonce: string;
}

/** The imeta tags for a rumor's attachments — one per image, PR-#2437
 * fields, riding the kind-1 itself: an attached image is part of its
 * note, not a second event. */
export const mediaTags = (images: readonly UploadedImage[], replyCek: Uint8Array): string[][] =>
  images.map((image) => [
    'imeta',
    `url ${image.url}`,
    `x ${image.x}`,
    `ox ${image.ox}`,
    `m ${image.mime}`,
    `encryption-algorithm ${FILE_ENCRYPTION}`,
    `decryption-key ${bytesToHex(replyCek)}`,
    `decryption-nonce ${image.nonce}`,
  ]);

/** One fetchable attachment, read off an imeta tag. */
export interface PrivateImage {
  /** https-only: event-sourced urls are never loaded off-scheme. */
  url: string;
  mime: string;
  /** The decryption key, hex — the conversation CEK by our convention. */
  key: string;
  nonce: string;
  /** sha256 of the ciphertext — verified before decrypt. */
  x?: string;
  ox?: string;
}

/** The attachments of a rumor, in tag order. Malformed references —
 * missing url/key/nonce, non-https urls, unencrypted imeta (nothing to
 * decrypt with) — are skipped: untrusted event data. */
export const mediaImagesOf = (rumor: Rumor): PrivateImage[] => {
  const images: PrivateImage[] = [];
  for (const [name, ...parts] of rumor.tags) {
    if (name !== 'imeta') continue;
    const field = (key: string): string | undefined =>
      parts.find((part) => part.startsWith(`${key} `))?.slice(key.length + 1);
    const url = field('url');
    const key = field('decryption-key');
    const nonce = field('decryption-nonce');
    const mime = field('m');
    if (!url || !key || !nonce || !mime) continue;
    const safe = sanitizeUrl(url);
    if (!safe) continue;
    images.push({ url: safe, mime, key, nonce, x: field('x'), ox: field('ox') });
  }
  return images;
};

/**
 * Fetch, integrity-check, and decrypt one attachment to a blob url
 * ready for <img>. A wrong sha256 or a failed GCM open throws — corrupt
 * or substituted storage must surface, never render. Ciphertext longer
 * than `maxBytes` (default 32 MB, mirroring the mediaMaxDownloadMb
 * default) is rejected before the GCM open — over-cap media is a
 * visible error, never a silent skip.
 */
export const loadPrivateImage = async (
  image: PrivateImage,
  maxBytes = 32 * 1024 * 1024,
): Promise<{ blobUrl: string; mime: string }> => {
  const ct = await blossomBytes(image.url, maxBytes);
  if (ct.length > maxBytes) {
    throw new Error(`media too large: ${ct.length} bytes exceeds ${maxBytes}`);
  }
  if (image.x && bytesToHex(sha256(ct)) !== image.x) {
    throw new Error('private image integrity check failed');
  }
  const bytes = decryptImage(image.key, image.nonce, ct);
  const blobUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image.mime }));
  return { blobUrl, mime: image.mime };
};
