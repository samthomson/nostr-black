import { describe, it, expect } from 'vitest';
import { hashtagsOf, tTagsOf } from './hashtags';

describe('hashtagsOf', () => {
  it('extracts hashtags at start-of-content and after whitespace', () => {
    expect(hashtagsOf('#nostr hello #bitcoin world')).toEqual(['nostr', 'bitcoin']);
  });

  it('lowercases and dedupes, keeping first-appearance order', () => {
    expect(hashtagsOf('#Nostr says #nostr again #Bitcoin #bitcoin')).toEqual(['nostr', 'bitcoin']);
  });

  it('a # inside a URL fragment is not a hashtag', () => {
    expect(hashtagsOf('see https://x.com/page#anchor and #real')).toEqual(['real']);
    expect(hashtagsOf('mid#word')).toEqual([]);
  });

  it('allows letters, digits and underscores; punctuation ends the tag', () => {
    expect(hashtagsOf('#hello_world2! #ok.')).toEqual(['hello_world2', 'ok']);
  });

  it('digit-only hashtags extract; a bare # does not', () => {
    expect(hashtagsOf('#2026 counts')).toEqual(['2026']);
    expect(hashtagsOf('just # alone')).toEqual([]);
  });

  it('tTagsOf pairs each value with the t name', () => {
    expect(tTagsOf('a #one b #Two')).toEqual([['t', 'one'], ['t', 'two']]);
  });
});
