import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { store, eventKey } from '@/data/store';
import {
  engagementOf,
  reactionsOf,
  repostsOf,
  EMPTY_ENGAGEMENT,
  type Engagement,
  type Reaction,
  type Repost,
} from '@/data/engagement';
import { scheduler, settleOf, type Lane } from '@/data/scheduler';

/**
 * Everything one note's engagement row reads: reply/zap counts, the
 * reactions and reposts lists (the who, for the viewer), and whether
 * the want has settled (spinner vs number).
 *
 * One hook per note, not per kind, because that is the shape of the
 * fetch — one engagement want, one `#e` query carrying every kind. The
 * lists and counts are all derived from the same ref index slice, so
 * they share one subscription.
 *
 * No id (private items): empty everything and no want — a rumor id is
 * unresolvable on relays and asking about one leaks the query. Private
 * reactions come from the conversation, not this hook.
 */
export interface EngagementFeed {
  replies: Engagement['replies'];
  zaps: Engagement['zaps'];
  /** True when the reply tally hit its cap — a floor, render `N+`. */
  capped: Engagement['capped'];
  reactions: readonly Reaction[];
  reactionsCapped: boolean;
  reposts: readonly Repost[];
  repostsCapped: boolean;
  /** The want has not finished a run — numbers are unknown, not zero. */
  pending: boolean;
}

/** What the ref-index snapshot holds; `pending` is derived in the hook
 * body from the settle subscription, so it never gates the snapshot's
 * identity check. */
type EngagementData = Omit<EngagementFeed, 'pending'>;

const EMPTY_DATA: EngagementData = Object.freeze({
  replies: 0,
  zaps: 0,
  capped: false,
  reactions: Object.freeze([]),
  reactionsCapped: false,
  reposts: Object.freeze([]),
  repostsCapped: false,
});

const sameData = (a: EngagementData, b: EngagementData): boolean =>
  a.replies === b.replies
  && a.zaps === b.zaps
  && a.capped === b.capped
  && a.reactionsCapped === b.reactionsCapped
  && a.repostsCapped === b.repostsCapped
  && a.reactions.length === b.reactions.length
  && a.reactions.every((r, i) => r.id === b.reactions[i].id)
  && a.reposts.length === b.reposts.length
  && a.reposts.every((r, i) => r.id === b.reposts[i].id);

export const useEngagementFeed = (
  id: string | undefined,
  lane: Lane = 'interactive',
): EngagementFeed => {
  const cache = useRef<EngagementData>(EMPTY_DATA);

  // The ref-index slice for this note.
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(eventKey(id ?? ''), onChange),
    [id],
  );

  // The want's settle state, on its own store subscription — the
  // spinner clears the moment the first run lands.
  const settledAt = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(settleOf(id ?? ''), onChange), [id]),
    useCallback(() => store.get(settleOf(id ?? '')).settledAt, [id]),
    useCallback(() => store.get(settleOf(id ?? '')).settledAt, [id]),
  );

  const snapshot = useCallback((): EngagementData => {
    if (!id) return EMPTY_DATA;
    const counts = engagementOf(store, id);
    const reactions = reactionsOf(store, id);
    const reposts = repostsOf(store, id);
    const next: EngagementData = {
      replies: counts.replies,
      zaps: counts.zaps,
      capped: counts.capped,
      reactions: reactions.items,
      reactionsCapped: reactions.capped,
      reposts: reposts.items,
      repostsCapped: reposts.capped,
    };
    if (sameData(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    scheduler.want({ type: 'engagement', target: id }, lane);
    return () => scheduler.drop({ type: 'engagement', target: id });
  }, [id, lane]);

  const data = useSyncExternalStore(subscribe, snapshot, snapshot);
  // pending is derived here, not inside the ref-index snapshot: the
  // settle subscription re-renders on its own key, and a snapshot that
  // embeds pending would only re-read when the ref index changes.
  return { ...data, pending: settledAt === undefined };
};

export { EMPTY_ENGAGEMENT };
