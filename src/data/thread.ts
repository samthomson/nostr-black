import type { NostrEvent } from '@nostrify/nostrify';
import { nip10 } from 'nostr-tools';
import type { EventStore } from './store';

/**
 * Direct children of a note — one hop, never a full tree.
 *
 * NIP-10 replies and NIP-22 comments both count. A kind 1111 that only
 * names this id as the thread *root* (`E`) is not a direct child; that
 * would pull the whole tree in one click.
 *
 * See `docs/data-layer.md` § Threads.
 */

export const THREAD_KINDS = [1, 1111] as const;
/** Direct children fetched for one open note. Past this the count is a floor. */
export const THREAD_LIMIT = 200;

export const isDirectChild = (event: NostrEvent, parentId: string): boolean => {
  if (event.kind === 1111) {
    const parent = event.tags.find(([name]) => name === 'e')?.[1];
    return parent === parentId;
  }
  if (event.kind !== 1) return false;
  const parsed = nip10.parse(event);
  const reply = parsed.reply?.id ?? parsed.root?.id;
  return reply === parentId;
};

/** Oldest first — a thread is read down, not as a feed. */
export const childrenOf = (target: EventStore, parentId: string): NostrEvent[] => {
  const out: NostrEvent[] = [];
  for (const id of target.getRefs(parentId)) {
    const event = target.getEvent(id);
    if (event && isDirectChild(event, parentId)) out.push(event);
  }
  return out.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
};
