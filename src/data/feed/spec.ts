import type { NostrEvent } from '@nostrify/nostrify';

/**
 * What a feed is, as data.
 *
 * The engine is parameterized over this rather than hardcoded to the
 * follow list, so the private-feed NIP lands as another spec instead of a
 * second pipeline beside this one.
 */
export interface FeedSpec {
  id: string;
  kinds: number[];
  /** Read fresh each fetch — the follow list changes under a live feed. */
  authors: () => readonly string[];
  /** `outbox` routes by each author's kind 10002; `explicit` uses `relays`. */
  routing: 'outbox' | 'explicit';
  relays?: readonly string[];
  /** Private feeds: unwrap before the event reaches the store. */
  decrypt?: (event: NostrEvent) => Promise<NostrEvent>;
}

/** Notes, reposts (6/16), pictures, video, files, long-form. */
export const FEED_KINDS = [1, 6, 16, 20, 21, 1063, 30023];

export const followsFeed = (authors: () => readonly string[]): FeedSpec => ({
  id: 'follows',
  kinds: FEED_KINDS,
  authors,
  routing: 'outbox',
});
