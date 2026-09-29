import { isPending, useEntity } from './useEntity';
import type { Lane } from '@/data/scheduler';
import type { NostrEvent } from '@nostrify/nostrify';

export interface FoundEvent {
  event: NostrEvent | undefined;
  pending: boolean;
}

/** One event by id. Hints and author go to `resolveById` routing. */
export const useEvent = (
  id: string | undefined,
  opts: { author?: string; hints?: readonly string[]; lane?: Lane } = {},
): FoundEvent => {
  const state = useEntity(
    id ? { type: 'event', id, author: opts.author, hints: opts.hints } : undefined,
    opts.lane ?? 'interactive',
  );
  return {
    event: state.event,
    pending: !!id && isPending(state),
  };
};
