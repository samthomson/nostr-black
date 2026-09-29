import { afterEach, describe, expect, it } from 'vitest';
import { clearFeeds, feedEngine, syncFeedAuthors } from './registry';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

afterEach(() => clearFeeds());

describe('feed registry', () => {
  it('hands the same engine to every caller of an id', () => {
    expect(feedEngine('home')).toBe(feedEngine('home'));
  });

  it('keeps feeds with different ids apart', () => {
    expect(feedEngine('home')).not.toBe(feedEngine('other'));
  });

  it('drops sealed pages when the author list changes', () => {
    const engine = feedEngine('home');
    syncFeedAuthors('home', [A]);

    // Stand in for a sealed page; reset is the observable effect.
    let resets = 0;
    engine.subscribe(() => (resets += 1));

    syncFeedAuthors('home', [A, B]);
    expect(resets).toBe(1);
  });

  it('does not reset for the same list, so a remount keeps the feed', () => {
    const engine = feedEngine('home');
    syncFeedAuthors('home', [A, B]);

    let resets = 0;
    engine.subscribe(() => (resets += 1));

    syncFeedAuthors('home', [A, B]);
    syncFeedAuthors('home', [...[A, B]]);
    expect(resets).toBe(0);
  });

  it('treats a reordered list as the same feed', () => {
    const engine = feedEngine('home');
    syncFeedAuthors('home', [A, B]);

    let resets = 0;
    engine.subscribe(() => (resets += 1));

    syncFeedAuthors('home', [B, A]);
    expect(resets).toBe(0);
  });

  it('forgets everything on clear', () => {
    const before = feedEngine('home');
    clearFeeds();
    expect(feedEngine('home')).not.toBe(before);
  });
});
