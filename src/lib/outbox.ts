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
  authorRelays: Map<string, RelayList>,
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

