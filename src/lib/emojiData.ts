/**
 * Offline emoji data for the picker, built once at module load from the
 * bundled `emojibase-data` (768KB raw, ~a quarter of that spoken). Nothing
 * is fetched: the picker works on Tor, on a plane, always. Group labels
 * and skin-tone names come from emojibase's `messages.json`.
 */
import data from 'emojibase-data/en/data.json';
import messages from 'emojibase-data/en/messages.json';
import cldrShortcodes from 'emojibase-data/en/shortcodes/cldr.json';
import emojibaseShortcodes from 'emojibase-data/en/shortcodes/emojibase.json';
import type { EmojiData, Locale } from 'frimousse';

/** frimousse's per-emoji entry, plus its canonical shortcode. */
type PickerEmoji = EmojiData['emojis'][number] & { canonicalShortcode: string };

/** frimousse's skin-tone keys, in emojibase's `tone` numbering. */
const TONE_KEYS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;

interface EmojibaseEntry {
  emoji: string;
  label: string;
  hexcode: string;
  group: number | null;
  version: number;
  tags?: readonly string[];
  skins?: readonly {
    emoji: string;
    tone: number;
  }[];
}

const groupLabels: Record<string, string> = Object.fromEntries(
  messages.groups.map((g) => [g.key, g.message]),
);

/** hexcode → shortcodes, cldr first so canonical `thumbs_up` wins over
 *  emojibase's squashed `thumbsup` (its extras still carry). */
const shortcodes: Record<string, readonly string[]> = {};
for (const [hexcode, value] of Object.entries(emojibaseShortcodes)) {
  shortcodes[hexcode] = Array.isArray(value) ? value : [value];
}
for (const [hexcode, value] of Object.entries(cldrShortcodes)) {
  const cldr = Array.isArray(value) ? value : [value];
  shortcodes[hexcode] = [...cldr, ...(shortcodes[hexcode] ?? []).filter((s) => !cldr.includes(s))];
}
const shortcodeWords = (hexcode: string): readonly string[] =>
  (shortcodes[hexcode] ?? []).map((s) => s.replaceAll('_', ' '));

/** hexcode → canonical shortcodes with underscores intact (`thumbs_up`). */
const rawShortcodes = (hexcode: string): readonly string[] => shortcodes[hexcode] ?? [];

const emojis: PickerEmoji[] = (data as EmojibaseEntry[])
  // components (group 2) are skin-tone/flag carriers — not pickable emoji
  .filter((e) => e.group !== 2)
  .map((e) => ({
    emoji: e.emoji,
    category: e.group ?? 9,
    label: e.label,
    version: e.version,
    tags: [...(e.tags ?? []), ...shortcodeWords(e.hexcode), ...rawShortcodes(e.hexcode)],
    canonicalShortcode: rawShortcodes(e.hexcode)[0] ?? '',
    skins: e.skins
      ? (Object.fromEntries(
          e.skins.map((s) => [TONE_KEYS[s.tone - 1], s.emoji]),
        ) as PickerEmoji['skins'])
      : undefined,
  }));

const enData: EmojiData = {
  locale: 'en',
  emojis,
  categories: messages.groups
    .filter((g) => g.key !== 'component' && groupLabels[g.key] !== undefined)
    .sort((a, b) => a.order - b.order)
    .map((g, index) => ({ index, label: groupLabels[g.key] })),
  skinTones: Object.fromEntries(
    messages.skinTones.map((s) => [s.key, s.message]),
  ) as EmojiData['skinTones'],
};

/** One locale is bundled; `en` gets it, anything else resolves to it too. */
export const bundledEmojiData = (locale: Locale): EmojiData => ({
  ...enData,
  locale,
});

/** One searchable emoji for the composer's `:` typeahead. */
export interface EmojiMatch {
  emoji: string;
  label: string;
  /** `:thumbs_up:` — the canonical shortcode. */
  shortcode: string;
}

const searchIndex = emojis.map((e) => ({
  emoji: e.emoji,
  label: e.label.toLowerCase(),
  haystack: [e.label, ...e.tags].join(' ').toLowerCase(),
  shortcodes: e.tags.filter((t) => t.includes(' ')),
  shortcode: e.canonicalShortcode,
}));

/**
 * The `:` typeahead matches, best first: shortcode prefix, then
 * shortcode word start, then label/tag containment. Empty query → the
 * common faces, so typing `:` alone is already useful.
 */
export const searchEmoji = (query: string, limit = 8): EmojiMatch[] => {
  // queries arrive either form: `thumbs_up` typed or `thumbs up` pasted
  const q = query.trim().toLowerCase().replaceAll(' ', '_');
  const qSpaced = q.replaceAll('_', ' ');
  if (q.length === 0) {
    return ['😀', '😂', '🥹', '😍', '🤔', '👍', '🔥', '❤️'].map((emoji) => {
      const hit = searchIndex.find((e) => e.emoji === emoji)!;
      return { emoji, label: hit.label, shortcode: hit.shortcode };
    });
  }
  const scored: { match: EmojiMatch; rank: number }[] = [];
  for (const e of searchIndex) {
    let rank = Infinity;
    for (const s of e.shortcodes) {
      if (s.startsWith(q) || s.startsWith(qSpaced)) rank = Math.min(rank, 0);
      else if (s.includes(`_${q}`)) rank = Math.min(rank, 1);
      else if (s.includes(q) || s.includes(qSpaced)) rank = Math.min(rank, 2);
    }
    if (rank === Infinity && (e.label.startsWith(q) || e.label.startsWith(qSpaced))) rank = 3;
    if (rank === Infinity && e.haystack.includes(qSpaced)) rank = 4;
    if (rank < Infinity) scored.push({ match: { emoji: e.emoji, label: e.label, shortcode: e.shortcode }, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).slice(0, limit).map((s) => s.match);
};
