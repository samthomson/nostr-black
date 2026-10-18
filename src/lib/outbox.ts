import { nip04, nip44 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

/** Pubkeys the user follows, from their kind 3 contact list. Deduped. */
export const parseFollows = (contactList: NostrEvent | undefined): string[] => {
  if (!contactList) return [];
  return [...new Set(
    contactList.tags
      .filter(([name]) => name === 'p')
      .map(([, pubkey]) => pubkey),
  )];
};

/** Non-`p` tags of a contact list (content, client tag…) — preserved on edit. */
const otherTags = (contactList: NostrEvent): string[][] =>
  contactList.tags.filter(([name]) => name !== 'p');

/**
 * The tags of an updated kind 3: the user's contacts with `pubkey` added
 * (at the front, most-recent-first like every nostr client) or removed.
 * Everything that isn't a `p` tag rides along untouched.
 */
export const toggleFollowTags = (
  contactList: NostrEvent | undefined,
  pubkey: string,
  follow: boolean,
): string[][] => {
  const rest = contactList ? otherTags(contactList) : [];
  const follows = contactList ? parseFollows(contactList) : [];
  const without = follows.filter((p) => p !== pubkey);
  const pTags = (follow ? [pubkey, ...without] : without).map((p) => ['p', p]);
  return [...pTags, ...rest];
};

/**
 * NIP-51 private list items: private entries live as a JSON array of
 * tags encrypted to self (NIP-44, key = mine with mine) in `content`.
 * Legacy NIP-04 ciphertext (`?iv=` marker) decrypts too.
 */
export const openPrivateList = (
  sk: Uint8Array,
  event: NostrEvent | undefined,
): readonly (readonly string[])[] => {
  if (!event?.content) return [];
  const ck = nip44.v2.utils.getConversationKey(sk, getPublicKey(sk));
  const json = event.content.includes('?iv=')
    ? nip04.decrypt(sk, getPublicKey(sk), event.content)
    : nip44.decrypt(event.content, ck);
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('private list content is not an array');
  return parsed.map((entry) => {
    if (!Array.isArray(entry)) throw new Error('private list entry is not a tag');
    return entry.map((cell) => String(cell));
  });
};

export const sealPrivateList = (
  sk: Uint8Array,
  items: readonly (readonly string[])[],
): string => {
  const ck = nip44.v2.utils.getConversationKey(sk, getPublicKey(sk));
  return nip44.encrypt(JSON.stringify(items), ck);
};

/** Private `p` entries of a NIP-51 list, opened with the session key. */
export const parsePrivateFollows = (sk: Uint8Array, event: NostrEvent | undefined): string[] =>
  [...new Set(
    openPrivateList(sk, event)
      .filter(([name]) => name === 'p')
      .map(([, pubkey]) => pubkey),
  )];

/** Muted pubkeys — public `p` tags (kind 10000) plus private entries. */
export const parseMutes = (
  sk: Uint8Array,
  muteList: NostrEvent | undefined,
): { public: string[]; private: string[] } => {
  const publicMutes = [...new Set(
    muteList?.tags.filter(([name]) => name === 'p').map(([, pubkey]) => pubkey) ?? [],
  )];
  const privateMutes = parsePrivateFollows(sk, muteList);
  return { public: publicMutes, private: privateMutes };
};

/** Shared NIP-51 plumbing for one list event's rebuild. The public
 * entries become tags; the private entries re-seal to self in content.
 * Non-`p` tags of the original ride along untouched, like kind 3. */
const listEventParts = (
  sk: Uint8Array,
  oldEvent: NostrEvent | undefined,
  publicNext: readonly string[],
  privateNext: readonly string[],
): { tags: string[][]; content: string } => {
  const pTags = publicNext.map((p) => ['p', p]);
  const privateEntries = privateNext.map((p) => ['p', p]);
  const rest = oldEvent
    ? oldEvent.tags.filter(([name]) => name !== 'p')
    : [];
  return {
    tags: [...pTags, ...rest],
    content: privateEntries.length > 0 ? sealPrivateList(sk, privateEntries) : '',
  };
};

/**
 * Rebuild a follow list (kind 3) moving `pubkey` between the public
 * tags and the sealed content: `to` = 'private' adds them to the
 * encrypted half, 'public' to the tags; `false` removes from whichever
 * list held them. The other half always survives — a public→private
 * move must not silently drop the person.
 */
export const moveFollow = (
  sk: Uint8Array,
  contactList: NostrEvent | undefined,
  pubkey: string,
  to: 'public' | 'private' | false,
): { tags: string[][]; content: string } => {
  const publicNext = parseFollows(contactList).filter((p) => p !== pubkey);
  const privateNext = parsePrivateFollows(sk, contactList).filter((p) => p !== pubkey);
  const parts = listEventParts(sk, contactList, publicNext, privateNext);
  if (to === 'public') parts.tags = [['p', pubkey], ...parts.tags];
  if (to === 'private') parts.content = sealPrivateList(sk, [...privateNext.map((p) => ['p', p] as const), ['p', pubkey] as const]);
  return parts;
};

/** Same rebuild for the mute list (kind 10000): move `pubkey` between
 * the public tags and the sealed content, or remove from whichever. */
export const moveMute = (
  sk: Uint8Array,
  muteList: NostrEvent | undefined,
  pubkey: string,
  to: 'public' | 'private' | false,
): { tags: string[][]; content: string } => {
  const mutes = parseMutes(sk, muteList);
  const publicNext = mutes.public.filter((p) => p !== pubkey);
  const privateNext = mutes.private.filter((p) => p !== pubkey);
  const parts = listEventParts(sk, muteList, publicNext, privateNext);
  if (to === 'public') parts.tags = [['p', pubkey], ...parts.tags];
  if (to === 'private') parts.content = sealPrivateList(sk, [...privateNext.map((p) => ['p', p] as const), ['p', pubkey] as const]);
  return parts;
};

export interface RelayList {
  read: string[];
  write: string[];
}

/**
 * A user's NIP-65 relay list (kind 10002). `r` tags without a marker mean
 * read+write.
 */
export const parseRelayList = (event: NostrEvent | undefined): RelayList => {
  const read: string[] = [];
  const write: string[] = [];

  for (const [name, url, marker] of event?.tags ?? []) {
    if (name !== 'r' || !url) continue;
    if (marker === undefined || marker === 'read') read.push(url);
    if (marker === undefined || marker === 'write') write.push(url);
  }

  return { read, write };
};

/** pubkey → where they publish, from their kind 10002 events. */
export const buildAuthorRelayMap = (
  relayLists: NostrEvent[],
): Map<string, RelayList> => {
  const map = new Map<string, RelayList>();
  // Latest 10002 wins (replaceable kind).
  const ordered = [...relayLists].sort((a, b) => a.created_at - b.created_at);
  for (const event of ordered) {
    map.set(event.pubkey, parseRelayList(event));
  }
  return map;
};

/** Groups kept for the feed query: relay url → author pubkeys. */
export type RelayGroups = Map<string, string[]>;

/**
 * Groups followed authors by the relays they publish to — every declared
 * write relay is kept. An author's outbox declaration is authoritative: a
 * relay is never skipped (they may publish unevenly across their list), so
 * coverage is complete. Bounded concurrency is applied by the caller, not
 * by dropping relays. Order is deterministic (most authors first) so batch
 * waves fetch high-coverage relays earliest. Authors with no NIP-65 list
 * are skipped entirely — we only ever query relays their owner declared.
 */
export const buildRelayGroups = (
  follows: string[],
  authorRelays: { get(pubkey: string): RelayList | undefined },
): RelayGroups => {
  const groups: RelayGroups = new Map();

  for (const pubkey of follows) {
    const { write } = authorRelays.get(pubkey) ?? { read: [], write: [] };
    for (const url of write) {
      const authors = groups.get(url) ?? [];
      authors.push(pubkey);
      groups.set(url, authors);
    }
  }

  // Deterministic order: most authors first, then url for stability.
  return new Map(
    [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    ),
  );
};
