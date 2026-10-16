import type { NostrEvent } from '@nostrify/nostrify';
import type { EventStore } from './store';

/**
 * Counts derived from the ref index.
 *
 * A count is an aggregate, not an entity. As more replies land the numbers
 * move on their own — there is no separate cache to invalidate.
 *
 * See `docs/data-layer.md` § Engagement.
 */

/** Direct responses: both reply formats, reactions, reposts, zaps. */
export const ENGAGEMENT_KINDS = [1, 1111, 6, 16, 7, 9735] as const;



/**
 * Per-target fetch cap. Hitting it means the number is a floor — the UI
 * must say so (`500+`), never invent a precise figure past what we have.
 */
export const REACTION_CAP = 500;

/** The note-level counts the row still shows inline. Reaction and
 * repost numbers are not aggregates — they are the live lists' lengths. */
export interface Engagement {
  replies: number;
  zaps: number;
  /** True when the reply tally hit the cap. The number is a floor. */
  capped: boolean;
}

export const EMPTY_ENGAGEMENT: Engagement = Object.freeze({
  replies: 0,
  zaps: 0,
  capped: false,
});

/** Tally a set of events that all reference the same target. */
export const tally = (events: readonly NostrEvent[]): Engagement => {
  const replies = new Set<string>();
  const zaps = new Set<string>();

  for (const event of events) {
    if (event.kind === 1 || event.kind === 1111) replies.add(event.id);
    else if (event.kind === 9735) zaps.add(event.id);
  }

  return {
    replies: replies.size,
    zaps: zaps.size,
    capped: replies.size >= REACTION_CAP,
  };
};

/** Live tally from whatever the store currently holds for this id. */
export const engagementOf = (target: EventStore, id: string): Engagement => {
  const events: NostrEvent[] = [];
  for (const ref of target.getRefs(id)) {
    const event = target.getEvent(ref);
    if (event) events.push(event);
  }
  return events.length === 0 ? EMPTY_ENGAGEMENT : tally(events);
};

export interface Reaction {
  /** Who reacted. */
  pubkey: string;
  /** The reaction itself: '+', '-', or an emoji. */
  content: string;
  /** The kind-7 event id — the delete target for toggling off. */
  id: string;
  created_at: number;
}

export interface Repost {
  /** Who reposted. */
  pubkey: string;
  /** The kind 6/16 event id — its author can delete it. */
  id: string;
  created_at: number;
}

/** A list with its completeness: `capped` means the fetch that filled
 * the ref index hit its per-target limit, so what we hold is a floor —
 * the count must render `N+`, never a precise number we cannot know. */
export interface EngagementList<T> {
  items: readonly T[];
  capped: boolean;
}

/** True when a relay served exactly the fetch cap — the honest signal
 * that more may exist beyond what we hold. */
const hitFetchCap = (events: readonly NostrEvent[]): boolean =>
  events.length >= REACTION_CAP;

/** The reposts on one target, newest first. */
export const repostsOf = (target: EventStore, id: string): EngagementList<Repost> => {
  const events: NostrEvent[] = [];
  for (const ref of target.getRefs(id)) {
    const event = target.getEvent(ref);
    if (event && (event.kind === 6 || event.kind === 16)) events.push(event);
  }
  return {
    items: events
      .sort((a, b) => b.created_at - a.created_at)
      .map((event) => ({ id: event.id, pubkey: event.pubkey, created_at: event.created_at })),
    capped: hitFetchCap(events),
  };
};

/**
 * The reactions on one target, deduped the NIP-25 way: one person, many
 * kind 7s — the reader cares about people, so an author's latest
 * reaction is the one that counts. Newest reactors first.
 */
export const reactionsOf = (target: EventStore, id: string): EngagementList<Reaction> => {
  const latest = new Map<string, NostrEvent>();
  for (const ref of target.getRefs(id)) {
    const event = target.getEvent(ref);
    if (!event || event.kind !== 7) continue;
    const held = latest.get(event.pubkey);
    if (!held || event.created_at >= held.created_at) latest.set(event.pubkey, event);
  }
  return {
    items: [...latest.values()]
      .sort((a, b) => b.created_at - a.created_at)
      .map((event) => ({ id: event.id, pubkey: event.pubkey, content: event.content, created_at: event.created_at })),
    capped: hitFetchCap([...latest.values()]),
  };
};
