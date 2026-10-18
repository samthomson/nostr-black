/** Decrypted private images by ciphertext hash, shared by every mount —
 * the feed, the thread and re-renders fetch one image once per session.
 * Capped: each entry holds a blob (megabytes post-decrypt), so the oldest
 * entry is evicted and revoked past the cap. */
export interface OpenedImage {
  blobUrl: string;
  mime: string;
}

export const CACHE_MAX = 24;
export const cache = new Map<string, OpenedImage>();

/** The decrypted blob url of an already-loaded image, by ciphertext
 * hash — what a note's lightbox set is built from. */
export const decryptedUrlOf = (x: string | undefined): string | undefined =>
  x !== undefined ? cache.get(x)?.blobUrl : undefined;
