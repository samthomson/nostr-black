import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Sealing a feed page.
 *
 * The rule the whole feed rests on: **a page, once shown, is never
 * re-sorted**. Nothing is inserted into the middle of what the reader is
 * looking at. Rendering events as each relay answers would put new material
 * both above and below where their eyes are; waiting for every relay before
 * showing anything is correct but slow. Sealing splits the difference — the
 * page waits, and once sealed it is immutable.
 *
 * Pure. See `docs/data-layer.md` § Ordering.
 */

export interface RelayResponse {
  url: string;
  events: readonly NostrEvent[];
  /** The relay sent EOSE. False means the deadline hit first. */
  eose: boolean;
}

export interface SealedPage {
  /** Sorted newest-first, deduped, and never reordered after this. */
  events: NostrEvent[];
  /** Everything at or above this timestamp is complete. */
  floor: number;
  /** Relays that missed the deadline — a gap waiting would not have closed. */
  degraded: string[];
  /** Every responding relay had nothing more below this range. */
  exhausted: boolean;
  /** How many relays answered at all. Zero means the page proves nothing. */
  responded: number;
}

/**
 * How far down a single relay's answer can be trusted.
 *
 * `undefined` means unknown: it never finished, so its silence below any
 * point says nothing. A relay that returned fewer than `limit` and then
 * EOSE has nothing older to give, which is what `-Infinity` records.
 */
export const completeDownTo = (
  response: RelayResponse,
  limit: number,
): number | undefined => {
  if (!response.eose) return undefined;
  if (response.events.length < limit) return -Infinity;

  return Math.min(...response.events.map((e) => e.created_at));
};

/** Newest first; ties broken on id so the order is total and stable. */
const byRecency = (a: NostrEvent, b: NostrEvent): number =>
  b.created_at - a.created_at || (a.id < b.id ? -1 : 1);

export const sealPage = (
  responses: readonly RelayResponse[],
  limit: number,
): SealedPage => {
  const degraded = responses.filter((r) => !r.eose).map((r) => r.url);
  const marks = responses
    .map((r) => completeDownTo(r, limit))
    .filter((mark): mark is number => mark !== undefined);

  // The *newest* of the per-relay marks: coverage is only solid down to the
  // point every responding relay has been heard from. Taking the oldest
  // would claim completeness in a range some relay never reported on.
  const floor = marks.length > 0 ? Math.max(...marks) : Number.POSITIVE_INFINITY;

  const deduped = new Map<string, NostrEvent>();
  for (const response of responses) {
    for (const event of response.events) deduped.set(event.id, event);
  }

  // Events below the floor are held back even though we have them. They sit
  // in a range we cannot prove is complete, so showing them now would mean
  // the next page has to interleave around them — exactly the reordering
  // this design exists to prevent. They are already in the store and will
  // come back in the page they belong to.
  const events = [...deduped.values()]
    .filter((event) => event.created_at >= floor)
    .sort(byRecency);

  return {
    events,
    floor,
    degraded,
    // Quiet relays that EOSE short do not prove the follow list is empty
    // when other outboxes never answered — that is a sparse sample, not a
    // complete page.
    exhausted:
      marks.length > 0 &&
      floor === Number.NEGATIVE_INFINITY &&
      degraded.length === 0,
    responded: marks.length,
  };
};
