import { isPending, useEntity } from './useEntity';
import type { Lane } from '@/data/scheduler';
import type { NostrEvent } from '@nostrify/nostrify';

export interface FoundEvent {
  event: NostrEvent | undefined;
  pending: boolean;
}

/** One event by id. Hints and author go to `resolveById` routing. The
 * hints signature re-declares the want when provenance grows (relays
 * merging into found-on after first render), so a miss is re-asked at
 * the relays that actually served the note. */
export const useEvent = (
  id: string | undefined,
  opts: { author?: string; hints?: readonly string[]; lane?: Lane } = {},
): FoundEvent => {
  const hintsSig = [...new Set(opts.hints ?? [])].sort().join(',');
  const state = useEntity(
    id ? { type: 'event', id, author: opts.author, hints: opts.hints } : undefined,
    opts.lane ?? 'interactive',
    hintsSig,
  );
  return {
    event: state.event,
    pending: !!id && isPending(state),
  };
};
