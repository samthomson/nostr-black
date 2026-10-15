import type { NostrEvent } from '@nostrify/nostrify';

/** The event size most relays cap at. Oversized events may be rejected. */
export const MAX_EVENT_BYTES = 64 * 1024;

export const eventBytes = (event: NostrEvent): number =>
  new TextEncoder().encode(JSON.stringify(event)).length;

export const eventTooLarge = (event: NostrEvent): boolean =>
  eventBytes(event) > MAX_EVENT_BYTES;
