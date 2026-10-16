import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useUserState } from '@/hooks/useUserState';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useEntities, useEntity } from '@/data/hooks/useEntity';
import { feedEngine, syncFeedAuthors, syncFeedKinds } from '@/data/feed/registry';
import { useMyBurners } from '@/auth/burners';
import type { FeedState } from '@/data/feed/engine';

/** Polling is cheap over a warm socket, but a Tor circuit is not. */
const POLL_MS = { tor: 180_000, direct: 45_000 };
/** A dead engagement relay must not stop the user scrolling. */
const HYDRATE_MS = { tor: 8_000, direct: 2_500 };

const FOLLOWS = 'follows';

export interface Feed extends FeedState {
  notes: readonly NostrEvent[];
  loadMore: () => void;
  acceptPending: () => void;
  isLoading: boolean;
  /** Following nobody — a verdict, not an absence of data. */
  noFollows: boolean;
  /** No contact list found, so "following nobody" cannot be claimed. */
  followsNotFound: boolean;
}

/** The follows feed, bound to React. */
export const useFeed = (): Feed => {
  const { state: userState, relaySyncedAt } = useUserState();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  // Enabled feed kinds come from config; the header dropdown toggles them.
  const feedKinds = config.feedKinds;
  const kindsKey = [...feedKinds].sort((a, b) => a - b).join(',');
  const self = user?.pubkey;
  const followKey = userState.follows.pubkeys.join(',');
  // Own burner pubkeys count as "you": their notes are yours and must
  // render in the feed like any other own note. Burners have no relay
  // list, so outbox routing skips them — they surface from the local
  // store when the broadcast queue ingests them.
  const burners = useMyBurners(self);
  const authors = useMemo(() => {
    const follows = followKey.length === 0 ? [] : followKey.split(',');
    const mine = self && follows.length > 0 && !follows.includes(self)
      ? [self, ...burners]
      : [...burners];
    return [...mine, ...follows];
  }, [self, followKey, burners]);
  const authorKey = authors.join(',');

  const engine = feedEngine(FOLLOWS);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  // The own follow-list fetch itself: "not found" is only claimable once
  // this want has settled (it waits for our relay list, then asks the
  // right relays). Same want key as the bootstrap's — deduped.
  const selfFollowList = useEntity(self ? { type: 'followList', pubkey: self } : undefined);
  const followsSettled = self === undefined || selfFollowList.settledAt !== undefined;

  // Outbox routing is only as good as the authors' NIP-65 lists, so the
  // feed declares them as wants of its own rather than hoping something
  // else fetched them first.
  const relayLists = useEntities('relayList', authors, 'prefetch');
  const routedCount = [...relayLists.values()].filter(
    (entry) => entry.event !== undefined || entry.settledAt !== undefined,
  ).length;
  const routedAll = authors.length === 0 || routedCount === authors.length;

  const [routingKey, setRoutingKey] = useState(authorKey);
  const [routingGaveUp, setRoutingGaveUp] = useState(false);
  if (authorKey !== routingKey) {
    setRoutingKey(authorKey);
    setRoutingGaveUp(false);
  }

  useEffect(() => {
    if (routedAll || authors.length === 0) return;
    const wait = config.torEnabled ? HYDRATE_MS.tor : HYDRATE_MS.direct;
    const timer = setTimeout(() => setRoutingGaveUp(true), wait);
    return () => clearTimeout(timer);
  }, [authorKey, routedAll, authors.length, config.torEnabled]);

  // One kind 10002 is not a feed: the first page would seal around whoever
  // arrived first (usually you) and never re-ask with the full author set.
  const waitingOnRouting = authors.length > 0 && !routedAll && !routingGaveUp;

  useEffect(() => {
    syncFeedAuthors(FOLLOWS, authors);
  }, [authors, authorKey]);

  useEffect(() => {
    syncFeedKinds(FOLLOWS, feedKinds);
  }, [feedKinds]);

  // Asking before routing is known means asking nobody. Asking again after
  // a page that reached nobody means asking nobody twice, so the trigger
  // is "never attempted", not "nothing on screen". Disk comes first: if
  // the store already has a window, show it and poll for anything newer.
  const topRequested = useRef('');
  useEffect(() => {
    topRequested.current = '';
  }, [authorKey, kindsKey]);

  useEffect(() => {
    if (authorKey.length === 0 || state.loading) return;
    if (state.attempts === 0) engine.hydrateFromStore();
    if (waitingOnRouting) return;
    if (topRequested.current === authorKey) return;
    topRequested.current = authorKey;
    void engine.loadMore();
  }, [engine, authorKey, waitingOnRouting, state.attempts, state.loading]);

  useEffect(() => {
    if (state.attempts === 0) return;
    const every = config.torEnabled ? POLL_MS.tor : POLL_MS.direct;
    const timer = setInterval(() => void engine.poll(), every);
    return () => clearInterval(timer);
  }, [engine, state.attempts, config.torEnabled]);

  const seenRouted = useRef(0);
  useEffect(() => {
    if (state.attempts === 0) {
      seenRouted.current = routedCount;
      return;
    }
    if (routedCount <= seenRouted.current) return;
    seenRouted.current = routedCount;
    const timer = setTimeout(() => void engine.poll(), 400);
    return () => clearTimeout(timer);
  }, [engine, routedCount, state.attempts]);

  const last = state.pages.at(-1);
  useEffect(() => {
    if (!last || last.hydrated) return;
    const wait = config.torEnabled ? HYDRATE_MS.tor : HYDRATE_MS.direct;
    const timer = setTimeout(() => engine.markHydrated(), wait);
    return () => clearTimeout(timer);
  }, [engine, last, config.torEnabled]);

  const loadMore = useCallback(() => {
    void engine.loadMore();
  }, [engine]);
  const acceptPending = useCallback(() => engine.acceptPending(), [engine]);

  const notes = state.pages.flatMap((page) => page.events);

  // Until the first NIP-65 sync attempt finishes, an empty feed may just
  // mean we asked the wrong relays. The user sees loading, not a verdict.
  const discoverySettled = relaySyncedAt !== undefined;

  return {
    ...state,
    notes,
    loadMore,
    acceptPending,
    isLoading:
      !discoverySettled ||
      waitingOnRouting ||
      (authors.length > 0 && notes.length === 0 && (state.loading || state.attempts === 0)),
    noFollows: discoverySettled && userState.follows.updatedAt > 0 && authors.length === 0,
    followsNotFound: discoverySettled && followsSettled && userState.follows.updatedAt === 0,
  };
};
