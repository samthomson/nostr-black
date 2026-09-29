import { createFeedEngine, type FeedEngine } from './engine';
import { followsFeed } from './spec';

/**
 * Feed engines live above the component tree.
 *
 * Navigating away and back must show the pages already sealed rather than
 * refetching and flashing empty, so the engine outlives the component. The
 * author list is held beside it and read fresh on every fetch, because the
 * follow list changes under a live feed.
 */

const engines = new Map<string, FeedEngine>();
const authors = new Map<string, readonly string[]>();
/** The author list each feed's current pages were built from. */
const builtFrom = new Map<string, string>();

export const feedEngine = (id: string): FeedEngine => {
  const existing = engines.get(id);
  if (existing) return existing;

  const engine = createFeedEngine(followsFeed(() => authors.get(id) ?? []));
  engines.set(id, engine);
  return engine;
};

/**
 * Point a feed at an author list. A *different* list is a different feed —
 * pages sealed from the old one cannot be reconciled with the new, so they
 * are dropped. The same list is not a change, which is what keeps the feed
 * on screen across a remount.
 */
export const syncFeedAuthors = (id: string, next: readonly string[]): void => {
  const engine = feedEngine(id);
  // Order is not part of the identity of a feed: the same people in a
  // different order is the same feed, and must not cost the reader their
  // place.
  const key = [...next].sort().join(',');

  authors.set(id, next);
  if (builtFrom.get(id) === key) return;

  builtFrom.set(id, key);
  engine.reset();
};

/** Tests build their own engines; this clears the shared ones. */
export const clearFeeds = (): void => {
  engines.clear();
  authors.clear();
  builtFrom.clear();
};
