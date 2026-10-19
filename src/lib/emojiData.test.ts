import { describe, expect, it } from 'vitest';
import { bundledEmojiData, searchEmoji } from './emojiData';

const en = await bundledEmojiData('en');

describe('bundledEmojiData', () => {
  it('serves every emoji with no network', () => {
    // a real dataset, not a stub: thousands of emoji, grouped
    expect(en.emojis.length).toBeGreaterThan(1500);
    expect(en.categories.map((c) => c.label)).toContain('smileys & emotion');
  });
  it('resolves any requested locale with the bundled english data', async () => {
    const other = await bundledEmojiData('de');
    expect(other.emojis.length).toBe(en.emojis.length);
    expect(other.locale).toBe('de');
  });

  it('excludes components and carries shortcodes for search', () => {
    // components are invisible carriers (skin tone, ZWJ) — never listed
    expect(en.emojis.some((e) => e.label === 'light skin tone')).toBe(false);
    const thumbs = en.emojis.find((e) => e.label === 'thumbs up');
    expect(thumbs).toBeDefined();
    expect(thumbs!.tags).toContain('thumbs up');
    expect(thumbs!.skins?.light).toBe('👍🏻');
  });

  it('keeps flags in their own category at the end', () => {
    const last = en.categories.at(-1);
    expect(last?.label).toBe('flags');
    expect(en.emojis.some((e) => e.category === last!.index)).toBe(true);
  });
});

describe('searchEmoji', () => {
  it('ranks shortcode prefix matches first', () => {
    const [first] = searchEmoji('thumbs_up');
    expect(first?.emoji).toBe('👍');
  });

  it('matches spaced queries against underscored shortcodes', () => {
    const [first] = searchEmoji('thumbs up');
    expect(first?.emoji).toBe('👍');
  });

  it('matches word starts inside a shortcode ("up" → 👍)', () => {
    const matches = searchEmoji('up', 20);
    expect(matches.some((m) => m.emoji === '👍')).toBe(true);
    // a word-start beat plain containment: 👍 above, say, the "cup" emoji
    const up = matches.findIndex((m) => m.emoji === '👍');
    const cup = matches.findIndex((m) => m.shortcode === 'cup_with_straw');
    if (cup !== -1) expect(up).toBeLessThan(cup);
  });

  it('falls back to label and tag containment', () => {
    const matches = searchEmoji('grinning');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.label).toContain('grinning');
  });

  it('empty query returns the common quick picks', () => {
    const matches = searchEmoji('');
    expect(matches).toHaveLength(8);
    expect(matches.map((m) => m.emoji)).toContain('👍');
    expect(matches.map((m) => m.emoji)).toContain('🔥');
  });

  it('caps results at the limit and returns nothing for garbage', () => {
    expect(searchEmoji('grinning', 3)).toHaveLength(3);
    expect(searchEmoji('zzzzqqqq')).toHaveLength(0);
  });
});
