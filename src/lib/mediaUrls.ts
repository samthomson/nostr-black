import type { NostrEvent } from '@nostrify/nostrify';
import type { Rumor } from '@/lib/feedEncryption';

/** File-extension test for video media urls (untrusted event data). */
export const VIDEO_URL = /\.(mp4|webm|mov)(\?[^#\s]*)?$/i;

/** File-extension test for renderable media urls (untrusted event data). */
export const MEDIA_URL = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov)(\?[^#\s]*)?$/i;

/** Media urls for an event: url/imeta tags first, then inline content links. */
export const mediaUrls = (event: NostrEvent | Rumor): string[] => {
  const urls: string[] = [];
  for (const [name, value, ...rest] of event.tags) {
    if (name === 'url' && value && MEDIA_URL.test(value)) urls.push(value);
    if (name === 'imeta') {
      const url = [value, ...rest].find((p) => p.startsWith('url '))?.slice(4);
      if (url) urls.push(url);
    }
  }
  for (const token of event.content.split(/\s+/)) {
    if (/^https?:\/\//.test(token) && MEDIA_URL.test(token)) urls.push(token);
  }
  return [...new Set(urls)];
};
