import type { NostrEvent } from '@nostrify/nostrify';
import type { Rumor } from '@/lib/feedEncryption';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

/** File-extension test for video media urls (untrusted event data). */
export const VIDEO_URL = /\.(mp4|webm|mov)(\?[^#\s]*)?$/i;

/** File-extension test for renderable media urls (untrusted event data). */
export const MEDIA_URL = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov)(\?[^#\s]*)?$/i;

/** Media urls for an event: url/imeta tags first, then inline content
 * links. Every url is https-gated — untrusted event data never decides
 * where the app connects. */
export const mediaUrls = (event: NostrEvent | Rumor): string[] => {
  const urls: string[] = [];
  for (const [name, value, ...rest] of event.tags) {
    if (name === 'url' && value && MEDIA_URL.test(value)) {
      const url = sanitizeUrl(value);
      if (url) urls.push(url);
    }
    if (name === 'imeta') {
      const parts = [value, ...rest];
      // PR-#2437 encrypted attachments: the url is ciphertext — the
      // private media path fetches and decrypts it, never this grid.
      if (parts.some((p) => p.startsWith('decryption-key '))) continue;
      const raw = parts.find((p) => p.startsWith('url '))?.slice(4);
      const url = raw ? sanitizeUrl(raw) : undefined;
      if (url) urls.push(url);
    }
    // NIP-23 longform cover — the article's own image tag.
    if (name === 'image' && value && MEDIA_URL.test(value)) {
      const url = sanitizeUrl(value);
      if (url) urls.push(url);
    }
  }
  for (const token of event.content.split(/\s+/)) {
    if (/^https?:\/\//.test(token) && MEDIA_URL.test(token)) {
      const url = sanitizeUrl(token);
      if (url) urls.push(url);
    }
  }
  return [...new Set(urls)];
};
