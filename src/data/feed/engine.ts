import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { queryRelayResult, type RelayResult } from '@/net/net';
import { store, type EventStore } from '@/data/store';
import { routingContext } from '@/data/context';
import { relayPlan, type RoutingContext } from '@/data/routing';
import { createSlotLimiter, type Lane, type SlotLimiter } from '@/data/slots';
import { sealPage, type RelayResponse, type SealedPage } from './seal';
import type { FeedSpec } from './spec';

/**
 * The feed engine.
 *
 * Pages are sealed on arrival and never reordered afterwards. Backwards
 * pagination walks `until` down from the completeness watermark; forwards
 * pagination is a poll rather than a live subscription, and its results
 * are buffered rather than spliced into what the reader is looking at.
 *
 * See `docs/data-layer.md` § Ordering.
 */

export interface FeedPage {
  events: NostrEvent[];
  floor: number;
  sealedAt: number;
  /**
   * Metadata wants for this page have settled or the deadline expired.
   * The next page does not dispatch until this is true.
   */
  hydrated: boolean;
}

export interface FeedState {
  /** Sealed and immutable, newest page first. */
  pages: readonly FeedPage[];
  /** Newer than `ceiling`, held back until the reader asks for them. */
  pending: readonly NostrEvent[];
  /** Newest `created_at` currently rendered. */
  ceiling: number;
  /** The next `until`. */
  cursor: number;
  loading: boolean;
  exhausted: boolean;
  /**
   * Completed `loadMore` calls since the last reset. Zero means untried,
   * which is not the same as tried-and-empty: a caller that cannot tell
   * them apart will retry forever against authors nobody can route to.
   */
  attempts: number;
  /** Relays that missed a deadline during the most recent page. */
  degraded: readonly string[];
}

export interface FeedEngine {
  getState(): FeedState;
  subscribe(onChange: () => void): () => void;
  /**
   * Seal a first page from whatever the store already holds — cold start.
   * Does not claim completeness: the cursor stays at now so the first
   * network fetch is the live top, not "older than this disk sample".
   * Returns whether anything was shown.
   */
  hydrateFromStore(): boolean;
  /** Fetch and seal the next page downwards. */
  loadMore(): Promise<void>;
  /** Look for anything newer than the ceiling and buffer it. */
  poll(): Promise<void>;
  /** Move the buffer into a sealed page at the top. */
  acceptPending(): void;
  /** Unblock the next page. Called when hydration settles or times out. */
  markHydrated(): void;
  reset(): void;
}

export const PAGE_LIMIT = 50;

/** Per relay, per page. Higher than the page so one relay can cover it alone. */
const LIMIT_PER_RELAY = 100;

const NOW = () => Math.floor(Date.now() / 1000);

const emptyState = (): FeedState => ({
  pages: [],
  pending: [],
  ceiling: 0,
  cursor: NOW(),
  loading: false,
  exhausted: false,
  attempts: 0,
  degraded: [],
});

export interface EngineDeps {
  target?: EventStore;
  context?: () => RoutingContext;
  limiter?: SlotLimiter;
  query?: typeof queryRelayResult;
  /**
   * How long a page waits from the first REQ, not from the first answer.
   * Zero waits for every relay. Default is 8s so a dead outbox cannot
   * hold the page for minutes.
   */
  pageWaitMs?: number;
}

export const createFeedEngine = (spec: FeedSpec, deps: EngineDeps = {}): FeedEngine => {
  const target = deps.target ?? store;
  const context = deps.context ?? routingContext;
  const limiter = deps.limiter ?? createSlotLimiter();
  const query = deps.query ?? queryRelayResult;
  const pageWaitMs = deps.pageWaitMs ?? 8_000;

  let state = emptyState();
  const listeners = new Set<() => void>();

  const set = (next: Partial<FeedState>): void => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };

  /** relay url → the authors that relay is being asked about. */
  const groups = (ctx: RoutingContext): Map<string, string[]> => {
    const authors = [...spec.authors()];
    if (authors.length === 0) return new Map();

    if (spec.routing === 'explicit') {
      return new Map((spec.relays ?? []).map((url) => [url, authors]));
    }

    const plan = relayPlan({ kind: 'manyAuthors', authors }, ctx);
    const out = new Map<string, string[]>();
    for (const [url, subjects] of plan.tiers[0]?.groups ?? []) out.set(url, [...subjects]);
    return out;
  };

  /**
   * One REQ per relay, in parallel under the slot budget. Results land in
   * the store as they arrive. The page waits `pageWaitMs` from the start
   * (or every EOSE), then seals; stragglers keep ingesting.
   */
  let leftover: Promise<void> | undefined;
  let leftoverKind: 'page' | 'poll' | undefined;
  let lastCollected: RelayResult[] = [];
  let lastAsked: string[] = [];

  const fanOut = async (
    ctx: RoutingContext,
    window: Pick<NostrFilter, 'until' | 'since'>,
    lane: Lane,
  ): Promise<RelayResponse[]> => {
    const collected: RelayResult[] = [];
    const plan = [...groups(ctx)];
    lastAsked = plan.map(([url]) => url);
    lastCollected = collected;
    const jobs = plan.map(async ([url, authors], i): Promise<RelayResult> => {
      // Only the first wave takes interactive slots. The rest is background
      // so on-screen engagement (counts) is not queued behind every outbox.
      const jobLane: Lane = lane === 'interactive' && i >= 8 ? 'background' : lane;
      const release = await limiter.acquire(jobLane);
      try {
        const result = await query(url, [{
          kinds: spec.kinds,
          authors,
          limit: LIMIT_PER_RELAY,
          ...window,
        }], pageWaitMs > 0 ? { timeoutMs: pageWaitMs } : {});
        target.ingest(result.events, url);
        collected.push(result);
        return result;
      } finally {
        release();
      }
    });

    if (jobs.length === 0) {
      leftover = undefined;
      leftoverKind = undefined;
      return [];
    }
    const done = Promise.all(jobs).then(() => undefined);
    leftover = done;
    if (pageWaitMs <= 0) {
      await done;
      return collected.slice();
    }

    await Promise.race([
      done,
      new Promise<void>((resolve) => setTimeout(resolve, pageWaitMs)),
    ]);
    // One more bounded wait if nobody has answered — never await a job
    // that has not even acquired a slot (leftover from the last page).
    if (collected.length === 0) {
      await Promise.race([
        Promise.race(jobs),
        new Promise<void>((resolve) => setTimeout(resolve, pageWaitMs)),
      ]);
    }
    return collected.slice();
  };

  /** A relay may answer with anyone; the spec decides whose notes count. */
  const onlySpecAuthors = (responses: RelayResponse[]): RelayResponse[] => {
    const allowed = new Set(spec.authors());
    return responses.map((r) => ({
      ...r,
      events: r.events.filter((e) => allowed.has(e.pubkey)),
    }));
  };

  const rendered = (): Set<string> =>
    new Set(state.pages.flatMap((page) => page.events.map((e) => e.id)));

  const hydrateFromStore = (): boolean => {
    if (state.pages.length > 0) return false;
    const authors = spec.authors();
    if (authors.length === 0) return false;

    const events = target.queryByAuthors(authors, spec.kinds).slice(0, PAGE_LIMIT);
    if (events.length === 0) return false;

    const oldest = events[events.length - 1].created_at;
    const newest = events[0].created_at;
    set({
      pages: [{ events, floor: oldest, sealedAt: 0, hydrated: true }],
      ceiling: newest,
      // Live top, not "older than this disk sample". Walking down from a
      // 5-day-old seed would skip everyone who posted since.
      cursor: NOW(),
      attempts: 1,
    });
    return true;
  };

  const withUnanswered = (responses: RelayResponse[]): RelayResponse[] => {
    const have = new Set(responses.map((r) => r.url));
    return [
      ...responses,
      ...lastAsked
        .filter((url) => !have.has(url))
        .map((url) => ({ url, events: [], eose: false })),
    ];
  };

  const applySealed = (page: SealedPage, replace: boolean, sealedAt: number): void => {
    if (page.responded === 0) {
      set({ degraded: page.degraded });
      return;
    }

    const already = replace ? new Set<string>() : rendered();
    const eligible = page.events.filter((e) => !already.has(e.id));
    const events = eligible.slice(0, PAGE_LIMIT);
    const clipped = eligible.length > events.length;
    const oldest = events.at(-1)?.created_at;
    const next = { events, floor: page.floor, sealedAt, hydrated: false };

    set({
      pages: events.length > 0
        ? (replace ? [next] : [...state.pages, next])
        : state.pages,
      cursor: clipped && oldest !== undefined
        ? oldest
        : page.exhausted ? state.cursor : page.floor - 1,
      ceiling: events.length > 0
        ? Math.max(replace ? 0 : state.ceiling, ...events.map((e) => e.created_at))
        : state.ceiling,
      exhausted: page.exhausted && !clipped,
      degraded: page.degraded,
    });
  };

  const loadMore = async (): Promise<void> => {
    if (state.loading || state.exhausted) return;
    set({ loading: true });

    try {
      const ctx = context();
      leftoverKind = 'page';
      const preview =
        state.pages.length === 0 ||
        (state.pages.length === 1 && state.pages[0].sealedAt === 0);
      // Pagination is prefetch so leftover first-page REQs cannot sit on
      // the 8 interactive slots that counts and the next click need.
      const lane: Lane = preview ? 'interactive' : 'prefetch';
      const responses = onlySpecAuthors(await fanOut(ctx, { until: state.cursor }, lane));
      leftoverKind = leftover ? 'page' : undefined;
      applySealed(
        sealPage(withUnanswered(responses), LIMIT_PER_RELAY),
        preview,
        Date.now(),
      );
    } finally {
      const wait = leftover;
      set({ attempts: state.attempts + 1, loading: false });
      if (wait) void wait.then(() => harvestLeftover());
    }
  };

  /**
   * Pull store events above the ceiling into pending (or onto a disk seed).
   * Returns true when the gap is too large to stitch — caller resets.
   */
  const absorbNewerFromStore = (): boolean => {
    const authors = spec.authors();
    if (authors.length === 0 || state.ceiling === 0) return false;

    const already = rendered();
    const buffered = new Set(state.pending.map((e) => e.id));
    const fresh = target
      .queryByAuthors(authors, spec.kinds, { since: state.ceiling + 1 })
      .filter((event) => !already.has(event.id) && !buffered.has(event.id));
    if (fresh.length === 0) return false;

    if (state.pending.length + fresh.length > PAGE_LIMIT) return true;

    const incoming = [...state.pending, ...fresh];
    const fromDisk = state.pages.length > 0 && state.pages.every((page) => page.sealedAt === 0);
    if (fromDisk) {
      const events = incoming.sort(
        (a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1),
      );
      set({
        pages: [
          {
            events,
            floor: events[events.length - 1].created_at,
            sealedAt: Date.now(),
            hydrated: true,
          },
          ...state.pages,
        ],
        pending: [],
        ceiling: Math.max(state.ceiling, events[0].created_at),
      });
      return false;
    }

    set({ pending: incoming });
    return false;
  };

  const harvestLeftover = (): void => {
    if (state.pages.length === 0) {
      hydrateFromStore();
      return;
    }
    if (leftoverKind === 'page' && state.pages.length === 1) {
      applySealed(
        sealPage(onlySpecAuthors(lastCollected), LIMIT_PER_RELAY),
        true,
        Date.now(),
      );
      leftoverKind = undefined;
      return;
    }
    leftoverKind = undefined;
    if (!absorbNewerFromStore()) return;
    reset();
    void loadMore();
  };

  const poll = async (): Promise<void> => {
    if (state.loading || state.pages.length === 0) return;

    const ctx = context();
    leftoverKind = 'poll';
    await fanOut(ctx, { since: state.ceiling + 1 }, 'background');
    leftoverKind = leftover ? 'poll' : undefined;
    if (absorbNewerFromStore()) {
      reset();
      await loadMore();
      return;
    }
    const wait = leftover;
    if (wait) void wait.then(() => harvestLeftover());
  };

  const acceptPending = (): void => {
    if (state.pending.length === 0) return;

    const events = [...state.pending]
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));

    set({
      pages: [{ events, floor: events[events.length - 1].created_at, sealedAt: Date.now(), hydrated: true }, ...state.pages],
      pending: [],
      ceiling: Math.max(state.ceiling, events[0].created_at),
    });
  };

  const reset = (): void => {
    state = emptyState();
    for (const listener of [...listeners]) listener();
  };

  return {
    getState: () => state,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    hydrateFromStore,
    markHydrated: () => {
      const last = state.pages.at(-1);
      if (!last || last.hydrated) return;
      set({
        pages: state.pages.map((page, i) =>
          i === state.pages.length - 1 ? { ...page, hydrated: true } : page),
      });
    },
    loadMore,
    poll,
    acceptPending,
    reset,
  };
};
