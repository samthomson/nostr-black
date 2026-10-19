import { describe, expect, it } from 'vitest';
import type { NostrMetadata } from '@nostrify/nostrify';
import {
  mentionEntityOf,
  mentionLabelOf,
  mentionedPubkeysOf,
  pTagsOf,
  searchMentions,
  type MentionCandidate,
} from './mentions';

const candidate = (pubkey: string, metadata: Record<string, string> = {}): MentionCandidate => ({
  pubkey,
  metadata: metadata as NostrMetadata,
});

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);

describe('searchMentions', () => {
  const follows = [
    candidate(ALICE, { display_name: 'Shan O’Donnell', name: 'shan' }),
    candidate(BOB, { name: 'bob' }),
    candidate(CAROL, { display_name: 'carol', name: 'car' }),
  ];

  it('matches a display-name prefix first', () => {
    const [first] = searchMentions('shan', follows);
    expect(first?.pubkey).toBe(ALICE);
  });

  it('matches inside the display name ("o’" finds Shan)', () => {
    expect(searchMentions('o’do', follows).map((c) => c.pubkey)).toEqual([ALICE]);
  });

  it('ranks display-name containment below its prefix but above name prefix', () => {
    // "car": carol's display name starts with it; shan's *name* ("shan")
    // only contains it. Carol wins.
    const [first] = searchMentions('car', follows);
    expect(first?.pubkey).toBe(CAROL);
  });

  it('falls through to the plain name', () => {
    expect(searchMentions('bob', follows).map((c) => c.pubkey)).toEqual([BOB]);
  });

  it('an empty query lists everyone (limit applies)', () => {
    expect(searchMentions('', follows)).toHaveLength(3);
    expect(searchMentions('', follows, 2)).toHaveLength(2);
  });

  it('a follow with no metadata never matches a text query', () => {
    const key = 'd'.repeat(64);
    expect(searchMentions('dd', [candidate(key)])).toEqual([]);
  });
});

describe('mentionEntityOf', () => {
  it('writes the NIP-27 entity the composer inserts', () => {
    expect(mentionEntityOf(candidate(BOB))).toMatch(new RegExp(`^nostr:npub1[02-9ac-hj-np-z]+`));
  });

  it('round-trips through the extractor', () => {
    const content = `hey ${mentionEntityOf(candidate(BOB))} look`;
    expect(mentionedPubkeysOf(content)).toEqual([BOB]);
  });
});

describe('mentionedPubkeysOf', () => {
  it('collects npub and nprofile entities in order', () => {
    const content = `a ${mentionEntityOf(candidate(BOB))} then ${mentionEntityOf(candidate(ALICE))}`;
    expect(mentionedPubkeysOf(content)).toEqual([BOB, ALICE]);
  });

  it('ignores non-profile entities and malformed bech32', () => {
    const content = 'nostr:note1abc nothing here nostr:npub1 garbage';
    expect(mentionedPubkeysOf(content)).toEqual([]);
  });

  it('content without mentions tags nobody', () => {
    expect(mentionedPubkeysOf('plain words @shorthand')).toEqual([]);
  });
});

describe('pTagsOf', () => {
  it('dedupes while keeping insertion order', () => {
    expect(pTagsOf([ALICE, BOB, ALICE])).toEqual([['p', ALICE], ['p', BOB]]);
  });
});

describe('mentionLabelOf', () => {
  it('prefers display_name, then name, then a clipped npub', () => {
    expect(mentionLabelOf(candidate(ALICE, { display_name: 'Shan', name: 's' }))).toBe('Shan');
    expect(mentionLabelOf(candidate(BOB, { name: 'bob' }))).toBe('bob');
    expect(mentionLabelOf(candidate(CAROL))).toMatch(/^npub1[a-z0-9]+…$/);
  });
});
