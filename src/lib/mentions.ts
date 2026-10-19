import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * NIP-27 mentions: search and encode.
 *
 * Search scores the user's resolved follows against a typed query —
 * display name, then name, then npub — so `@shan` finds "Shan O'Donnell".
 * Encoding is the NIP-27 half: what the composer writes into the content
 * (`nostr:npub1…`) and the notification tag it declares alongside.
 */

/** One searchable person: a follow with its resolved kind 0 metadata. */
export interface MentionCandidate {
  pubkey: string;
  metadata: NostrMetadata | undefined;
}

/** npub prefix so a pasted or typed key can find its person too. Three
 *  call sites (display-name search, npub search, row label) share it. */
const npubOf = (pubkey: string): string => {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return '';
  }
};

/**
 * Follows matching a mention query, best first: display-name prefix,
 * display-name containment, name prefix, name containment. Empty query
 * → everyone (cap applies). Ties keep the follow-list order
 * (Array#sort is stable). People are found by name — a pasted npub in
 * the prose renders through NIP-21 regardless.
 */
export const searchMentions = (
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 8,
): MentionCandidate[] => {
  const q = query.trim().toLowerCase();

  const scoreOf = (candidate: MentionCandidate): number => {
    const display = (candidate.metadata?.display_name ?? '').toLowerCase();
    const name = (candidate.metadata?.name ?? '').toLowerCase();
    if (display.startsWith(q)) return 0;
    if (display.includes(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return 4;
  };

  return candidates
    .filter((candidate) => scoreOf(candidate) < 4)
    .sort((a, b) => scoreOf(a) - scoreOf(b))
    .slice(0, limit);
};

/**
 * The one display name for a mention row: display_name, then name, then
 * a clipped npub — the same way the feed labels an author.
 */
export const mentionLabelOf = (candidate: MentionCandidate): string =>
  candidate.metadata?.display_name
  || candidate.metadata?.name
  || `${npubOf(candidate.pubkey).slice(0, 10)}…`;

/**
 * NIP-27: the bech32 entity a mention inserts into the content — an
 * npub for every candidate. nprofile's relay hints would name where a
 * person reads; that is the follower's knowledge to hold privately,
 * not something every mentioned note republishes.
 */
export const mentionEntityOf = (candidate: MentionCandidate): string => {
  try {
    return `nostr:${nip19.npubEncode(candidate.pubkey)}`;
  } catch {
    return '';
  }
};

/** Hex pubkeys of every NIP-27 profile entity in the content — the
 *  mention `p` tags, derived at publish time so the content is the one
 *  source of truth (edits can't orphan a tag). Malformed entities tag
 *  nobody. */
export const mentionedPubkeysOf = (content: string): string[] => {
  const pubkeys: string[] = [];
  for (const match of content.matchAll(/nostr:((?:npub|nprofile)1[a-z0-9]+)/g)) {
    try {
      const decoded = nip19.decode(match[1]!);
      if (decoded.type === 'npub') pubkeys.push(decoded.data);
      if (decoded.type === 'nprofile') pubkeys.push(decoded.data.pubkey);
    } catch {
      // A malformed entity renders as text — it tags nobody.
    }
  }
  return pubkeys;
};

/**
 * The notification tag NIP-27 declares alongside mentioned profiles:
 * deduped, insertion-ordered.
 */
export const pTagsOf = (pubkeys: readonly string[]): string[][] => {
  const seen = new Set<string>();
  const tags: string[][] = [];
  for (const pubkey of pubkeys) {
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    tags.push(['p', pubkey]);
  }
  return tags;
};
