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

export interface Engagement {
  replies: number;
  reactions: number;
  downvotes: number;
  reposts: number;
  zaps: number;
  /** True when a tally hit the cap. The number is a floor, not a count. */
  capped: boolean;
}

export const EMPTY_ENGAGEMENT: Engagement = Object.freeze({
  replies: 0,
  reactions: 0,
  downvotes: 0,
  reposts: 0,
  zaps: 0,
  capped: false,
});

/** Tally a set of events that all reference the same target. */
export const tally = (events: readonly NostrEvent[]): Engagement => {
  const replies = new Set<string>();
  const likes = new Set<string>();
  const downvotes = new Set<string>();
  const reposts = new Set<string>();
  const zaps = new Set<string>();

  for (const event of events) {
    if (event.kind === 1 || event.kind === 1111) replies.add(event.id);
    else if (event.kind === 6 || event.kind === 16) reposts.add(event.id);
    else if (event.kind === 9735) zaps.add(event.id);
    else if (event.kind === 7) {
      // NIP-25: one person, many kind 7s — the reader cares about people.
      if (event.content === '-') downvotes.add(event.pubkey);
      else likes.add(event.pubkey);
    }
  }

  const capped =
    likes.size >= REACTION_CAP ||
    downvotes.size >= REACTION_CAP ||
    replies.size >= REACTION_CAP;

  return {
    replies: replies.size,
    reactions: likes.size,
    downvotes: downvotes.size,
    reposts: reposts.size,
    zaps: zaps.size,
    capped,
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
