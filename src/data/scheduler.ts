import type { NostrFilter } from '@nostrify/nostrify';
import { queryRelay } from '@/net/net';
import {
  store,
  eventKey,
  replaceableKey,
  addressableKey,
  type EntityKey,
  type EventStore,
} from './store';
import { routingContext } from './context';
import { myReadRelays, relayPlan, tierRelays, type RoutingContext } from './routing';
import { createSlotLimiter, LANES, rank, type Lane, type SlotLimiter } from './slots';
import { ENGAGEMENT_KINDS, REACTION_CAP } from './engagement';
import { THREAD_KINDS, THREAD_LIMIT } from './thread';
import { FEED_KINDS } from './feed/spec';
import { KIND_CONNECTION, KIND_PRIVATE_NOTE, KIND_PRIVATE_REPLY } from '@/lib/fe';

/**
 * The scheduler.
 *
 * The UI never requests anything; it declares a want. Wants are the dedupe
 * boundary — before the network, not in a cache key. Two hundred notes by
 * the same author declare the same profile want, and one filter goes out.
 *
 * See `docs/data-layer.md` § Wants and the scheduler.
 */

export type Want =
  | { type: 'profile'; pubkey: string }
  | { type: 'relayList'; pubkey: string }
  | { type: 'followList'; pubkey: string }
  | { type: 'event'; id: string; author?: string; hints?: readonly string[] }
  | { type: 'addressable'; kind: number; pubkey: string; d: string }
  | { type: 'engagement'; target: string }
  | { type: 'thread'; parent: string; author?: string }
  | { type: 'authorNotes'; pubkey: string }
  | { type: 'followers'; pubkey: string }
  | { type: 'connections'; derivedIdentityId: string } // our whole graph: kind 30378 by #c = derived_identity_id = H(my_sk ‖ label), known only to us
  | { type: 'connectionOffer'; d: string; offerer: string } // one pair's records: kind 30378 by #d = conn_addr(me, peer); `offerer` outboxes the query to their write relays
  | { type: 'privateNotes'; aliases: readonly string[]; peers: readonly string[] } // kind 1370 by #f = alias(peer, me); `peers` fans the query out to their write relays
  | { type: 'privateReplies'; noteIds: readonly string[]; peers: readonly string[] } // kind 1470 by #n = note_id(reply CEK); `peers` fans the query out

export type { Lane };

export type ReplaceableWantType = 'profile' | 'relayList' | 'followList';

const REPLACEABLE_KIND: Record<ReplaceableWantType, number> = {
  profile: 0,
  relayList: 10002,
  followList: 3,
};

/** How long a satisfied want stays fresh before it may be asked again. */
const STALE_MS: Record<Want['type'], number> = {
  profile: 15 * 60_000,
  relayList: 60 * 60_000,
  followList: 15 * 60_000,
  event: Number.POSITIVE_INFINITY,
  addressable: 15 * 60_000,
  engagement: 5 * 60_000,
  thread: 2 * 60_000,
  authorNotes: 5 * 60_000,
  followers: 15 * 60_000,
  connections: 2 * 60_000,
  connectionOffer: 2 * 60_000,
  privateNotes: 2 * 60_000,
  privateReplies: 2 * 60_000,
};

/** Pending wants accumulate this long, so a scrolling feed sends one batch. */
const DEBOUNCE_MS = 80;

/** Relays reject enormous filters; split the author list past this. */
const MAX_AUTHORS = 200;
export const AUTHOR_NOTES_LIMIT = 50;
export const FOLLOWER_CAP = 200;
export const CONNECTION_CAP = 200;
export const PRIVATE_NOTES_LIMIT = 50;
export const PRIVATE_REPLY_LIMIT = 200;

/**
 * Wants that route by the user's own read relays. Until the user's kind
 * 10002 has synced, myReadRelays falls back to discovery — relays that
 * do not host private kinds — so a miss there is not a verdict. These
 * park instead of settling, and re-run once routing resolves.
 */
const SELF_ROUTED: ReadonlySet<Want['type']> = new Set([
  'connections',
  'connectionOffer',
  'privateNotes',
  'privateReplies',
]);

export const wantKey = (want: Want): string => {
  switch (want.type) {
    case 'profile':
    case 'relayList':
    case 'followList':
      return `${want.type}:${want.pubkey}`;
    case 'event':
      return `event:${want.id}`;
    case 'addressable':
      return `a:${want.kind}:${want.pubkey}:${want.d}`;
    case 'engagement':
      return `engagement:${want.target}`;
    case 'thread':
      return `thread:${want.parent}`;
    case 'authorNotes':
      return `authorNotes:${want.pubkey}`;
    case 'followers':
      return `followers:${want.pubkey}`;
    case 'connections':
      return `connections:${want.derivedIdentityId}`;
    case 'connectionOffer':
      return `offer:${want.d}`;
    case 'privateNotes':
      return `pn:${[...want.aliases].sort().join(',')}`;
    case 'privateReplies':
      return `pr:${[...want.noteIds].sort().join(',')}`;
  }
};

/** The store entity a want settles on. Aggregates use synthetic keys. */
export const wantEntity = (want: Want): EntityKey | undefined => {
  switch (want.type) {
    case 'profile':
    case 'relayList':
    case 'followList':
      return replaceableKey(REPLACEABLE_KIND[want.type], want.pubkey);
    case 'event':
      return eventKey(want.id);
    case 'addressable':
      return addressableKey(want.kind, want.pubkey, want.d);
    case 'engagement':
      return undefined;
    case 'thread':
      return `t:${want.parent}`;
    case 'authorNotes':
      return `n:${want.pubkey}`;
    case 'followers':
      return `f:${want.pubkey}`;
    case 'connections':
      return `cn:${want.derivedIdentityId}`;
    case 'connectionOffer':
      return `co:${want.d}`;
    case 'privateNotes':
      return `pn:${[...want.aliases].sort().join(',')}`;
    case 'privateReplies':
      return `pr:${[...want.noteIds].sort().join(',')}`;
  }
};

interface Queued {
  want: Want;
  lane: Lane;
}

export interface Scheduler {
  want(want: Want, lane: Lane): void;
  promote(want: Want, lane: Lane): void;
  drop(want: Want): void;
  /** Re-run wants parked while our own routing was unresolved. */
  reroute(): void;
  /** Run the pending batch now instead of waiting out the debounce. */
  flush(): Promise<void>;
  /**
   * Make everything stale without disturbing work in progress. Wants
   * already declared stay declared — dropping them would strand a
   * component on a spinner it can never clear, since a mounted hook
   * declares its want once.
   */
  invalidate(): void;
  /** Forget everything. Full teardown, for tests. */
  reset(): void;
}

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** relay url → the pubkeys that relay is being asked about. */
type Groups = Map<string, Set<string>>;

const addGroup = (groups: Groups, url: string, pubkeys: Iterable<string>): void => {
  const set = groups.get(url) ?? new Set<string>();
  for (const pubkey of pubkeys) set.add(pubkey);
  groups.set(url, set);
};

export const createScheduler = (
  target: EventStore = store,
  context: () => RoutingContext = routingContext,
  limiter: SlotLimiter = createSlotLimiter(),
): Scheduler => {
  const pending = new Map<string, Queued>();
  const satisfiedAt = new Map<string, number>();
  /** Wants that ran on the discovery fallback and await real routing. */
  const rerouteQueue = new Map<string, Queued>();
  /** The pubkey whose own relay list settled empty — fallback is then authoritative. */
  let selfResolvedFor: string | undefined;
  const inflight = new Set<string>();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;

  const fresh = (want: Want): boolean => {
    const at = satisfiedAt.get(wantKey(want));
    if (at === undefined) return false;
    const window = STALE_MS[want.type];
    if (!Number.isFinite(window)) {
      // Immutable events: a *hit* stays forever. A miss does not — we may
      // not have known the author's relays yet.
      if (want.type === 'event' && target.getEvent(want.id)) return true;
      return false;
    }
    return Date.now() - at < window;
  };

  const enqueue = (want: Want, lane: Lane): void => {
    const key = wantKey(want);
    if (inflight.has(key) || fresh(want)) return;

    const queued = pending.get(key);
    if (queued) {
      // Already queued: the most urgent caller wins.
      if (rank(lane) < rank(queued.lane)) queued.lane = lane;
      return;
    }

    pending.set(key, { want, lane });
    if (timer === undefined) timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  /** One REQ per relay per chunk, ingested under the relay it came from. */
  const runGroups = async (
    lane: Lane,
    groups: Groups,
    filterOf: (subjects: string[]) => NostrFilter,
    size: number = MAX_AUTHORS,
  ): Promise<void> => {
    const jobs: Promise<void>[] = [];

    for (const [url, subjects] of groups) {
      for (const slice of chunk([...subjects], size)) {
        jobs.push((async () => {
          const release = await limiter.acquire(lane);
          try {
            target.ingest(await queryRelay(url, [filterOf(slice)]), url);
          } finally {
            release();
          }
        })());
      }
    }

    await Promise.all(jobs);
  };

  /** The user's own identity events: their write relays plus discovery. */
  const bootstrapRelays = (ctx: RoutingContext): string[] =>
    tierRelays(relayPlan({ kind: 'bootstrap', pubkey: ctx.pubkey! }, ctx).tiers[0]);

  /**
   * Kind 0 lives on the author's own write relays (outbox). Authors whose
   * relay list we do not have yet are asked for on ours, and a relay-list
   * want is queued so the next lookup is outbox-correct.
   */
  const profileGroups = (ctx: RoutingContext, pubkeys: string[]): Groups => {
    const groups: Groups = new Map();
    const unknown: string[] = [];
    const known: string[] = [];

    for (const pubkey of pubkeys) {
      if (pubkey === ctx.pubkey) continue;
      if ((ctx.authorRelays.get(pubkey)?.write.length ?? 0) > 0) known.push(pubkey);
      else unknown.push(pubkey);
    }

    for (const tier of relayPlan({ kind: 'manyAuthors', authors: known }, ctx).tiers) {
      for (const [url, authors] of tier.groups) addGroup(groups, url, authors);
    }

    if (unknown.length > 0) {
      for (const url of myReadRelays(ctx)) addGroup(groups, url, unknown);
      for (const pubkey of unknown) enqueue({ type: 'relayList', pubkey }, 'background');
    }

    if (ctx.pubkey && pubkeys.includes(ctx.pubkey)) {
      for (const url of bootstrapRelays(ctx)) addGroup(groups, url, [ctx.pubkey]);
    }

    return groups;
  };

  /**
   * A kind 10002 can only be looked for where we already read — knowing
   * where *they* publish is the thing the lookup is for. Discovery relays
   * are reserved for the logged-in user's own identity events, so other
   * people's lists are never sought there.
   */
  const relayListGroups = (ctx: RoutingContext, pubkeys: string[]): Groups => {
    const groups: Groups = new Map();
    const others = pubkeys.filter((pubkey) => pubkey !== ctx.pubkey);

    if (others.length > 0) {
      for (const url of myReadRelays(ctx)) addGroup(groups, url, others);
    }

    if (ctx.pubkey && pubkeys.includes(ctx.pubkey)) {
      for (const url of bootstrapRelays(ctx)) addGroup(groups, url, [ctx.pubkey]);
    }

    return groups;
  };

  const runLane = async (lane: Lane, batch: Queued[]): Promise<void> => {
    const ctx = context();
    const byType = (type: ReplaceableWantType): string[] =>
      batch.filter((q) => q.want.type === type).map((q) => {
        if (q.want.type !== type) return '';
        return q.want.pubkey;
      }).filter(Boolean);

    const profiles = byType('profile');
    const relayLists = byType('relayList');

    const follows = byType('followList');
    const events = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'event' }> => w.type === 'event');
    const addressables = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'addressable' }> => w.type === 'addressable');
    const engagement = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'engagement' }> => w.type === 'engagement');
    const threads = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'thread' }> => w.type === 'thread');
    const authorNotes = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'authorNotes' }> => w.type === 'authorNotes');
    const followers = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'followers' }> => w.type === 'followers');
    const connections = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'connections' }> => w.type === 'connections');
    const offers = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'connectionOffer' }> => w.type === 'connectionOffer');
    const privateNotes = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'privateNotes' }> => w.type === 'privateNotes');
    const privateReplies = batch
      .map((q) => q.want)
      .filter((w): w is Extract<Want, { type: 'privateReplies' }> => w.type === 'privateReplies');

    await Promise.all([
      profiles.length > 0
        ? runGroups(lane, profileGroups(ctx, profiles), (authors) => ({
            kinds: [REPLACEABLE_KIND.profile],
            authors,
          }))
        : undefined,
      relayLists.length > 0
        ? runGroups(lane, relayListGroups(ctx, relayLists), (authors) => ({
            kinds: [REPLACEABLE_KIND.relayList],
            authors,
          }))
        : undefined,
      follows.length > 0
        ? runGroups(lane, profileGroups(ctx, follows), (authors) => ({
            kinds: [REPLACEABLE_KIND.followList],
            authors,
          }))
        : undefined,
      events.length > 0 ? runEventWants(lane, ctx, events) : undefined,
      addressables.length > 0 ? runAddressableWants(lane, ctx, addressables) : undefined,
      engagement.length > 0 ? runEngagementWants(lane, ctx, engagement) : undefined,
      threads.length > 0 ? runThreadWants(lane, ctx, threads) : undefined,
      authorNotes.length > 0 ? runAuthorNotesWants(lane, ctx, authorNotes) : undefined,
      followers.length > 0 ? runFollowerWants(lane, ctx, followers) : undefined,
      connections.length > 0 ? runTagWants(
        lane,
        ctx,
        [...new Set(connections.map((w) => w.derivedIdentityId))],
        (ids) => ({ kinds: [KIND_CONNECTION], '#c': ids, limit: CONNECTION_CAP * ids.length }),
        20,
      ) : undefined,
      offers.length > 0 ? runTagWants(
        lane,
        ctx,
        [...new Set(offers.map((w) => w.d))],
        (ids) => ({ kinds: [KIND_CONNECTION], '#d': ids }),
        20,
        [...new Set(offers.map((w) => w.offerer))],
      ) : undefined,
      privateNotes.length > 0 ? runTagWants(
        lane,
        ctx,
        [...new Set(privateNotes.flatMap((w) => w.aliases))],
        (aliases) => ({ kinds: [KIND_PRIVATE_NOTE], '#f': aliases, limit: PRIVATE_NOTES_LIMIT }),
        50,
        [...new Set(privateNotes.flatMap((w) => w.peers))],
      ) : undefined,
      privateReplies.length > 0 ? runTagWants(
        lane,
        ctx,
        [...new Set(privateReplies.flatMap((w) => w.noteIds))],
        (ids) => ({ kinds: [KIND_PRIVATE_REPLY], '#n': ids, limit: PRIVATE_REPLY_LIMIT }),
        50,
        [...new Set(privateReplies.flatMap((w) => w.peers))],
      ) : undefined,
    ]);
  };

  const runEventWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'event' }>[],
  ): Promise<void> => {
    const groups: Groups = new Map();

    for (const want of wants) {
      if (want.author && !ctx.authorRelays.get(want.author)) {
        enqueue({ type: 'relayList', pubkey: want.author }, 'background');
      }
      const plan = relayPlan({
        kind: 'resolveById',
        id: want.id,
        author: want.author,
        hints: want.hints ?? [],
      }, ctx);
      for (const tier of plan.tiers) {
        for (const url of tier.groups.keys()) addGroup(groups, url, [want.id]);
      }
    }

    await runGroups(lane, groups, (ids) => ({ ids }), 50);
  };

  const runAddressableWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'addressable' }>[],
  ): Promise<void> => {
    await Promise.all(wants.map(async (want) => {
      const plan = relayPlan({ kind: 'oneAuthor', pubkey: want.pubkey }, ctx);
      const groups: Groups = new Map();
      for (const tier of plan.tiers) {
        for (const url of tier.groups.keys()) addGroup(groups, url, [want.pubkey]);
      }
      await runGroups(lane, groups, (authors) => ({
        kinds: [want.kind],
        authors,
        '#d': [want.d],
      }), 1);
    }));
  };

  const runEngagementWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'engagement' }>[],
  ): Promise<void> => {
    const targets = wants.map((want) => {
      const foundOn = target.get(eventKey(want.target)).foundOn ?? [];
      return {
        id: want.target,
        foundOn: foundOn.length > 0 ? foundOn : myReadRelays(ctx),
      };
    });

    const plan = relayPlan({ kind: 'engagement', targets }, ctx);
    const groups: Groups = new Map();
    for (const tier of plan.tiers) {
      for (const [url, ids] of tier.groups) addGroup(groups, url, ids);
    }

    await runGroups(
      lane,
      groups,
      (ids) => ({
        kinds: [...ENGAGEMENT_KINDS],
        '#e': ids,
        limit: Math.min(REACTION_CAP * ids.length, 2000),
      }),
      50,
    );
  };

  const runThreadWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'thread' }>[],
  ): Promise<void> => {
    await Promise.all(wants.map(async (want) => {
      const foundOn = target.get(eventKey(want.parent)).foundOn ?? [];
      const plan = relayPlan({
        kind: 'engagement',
        targets: [{ id: want.parent, foundOn }],
        rootAuthor: want.author,
      }, ctx);
      const groups: Groups = new Map();
      for (const tier of plan.tiers) {
        for (const [url, ids] of tier.groups) addGroup(groups, url, ids);
      }
      await runGroups(
        lane,
        groups,
        (ids) => ({
          kinds: [...THREAD_KINDS],
          '#e': ids,
          limit: THREAD_LIMIT * ids.length,
        }),
        50,
      );
    }));
  };

  const runAuthorNotesWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'authorNotes' }>[],
  ): Promise<void> => {
    // Outbox, same as the feed — not identity bootstrap. Own notes queried
    // on discovery (or not at all) is how a profile can be empty while the
    // same notes sit on the follows feed.
    const groups: Groups = new Map();
    for (const want of wants) {
      const plan = relayPlan({ kind: 'oneAuthor', pubkey: want.pubkey }, ctx);
      for (const tier of plan.tiers) {
        for (const [url, authors] of tier.groups) addGroup(groups, url, authors);
      }
    }
    await runGroups(
      lane,
      groups,
      (authors) => ({
        kinds: [...FEED_KINDS],
        authors,
        limit: AUTHOR_NOTES_LIMIT * authors.length,
      }),
    );
  };

  const runFollowerWants = async (
    lane: Lane,
    ctx: RoutingContext,
    wants: Extract<Want, { type: 'followers' }>[],
  ): Promise<void> => {
    const groups: Groups = new Map();
    for (const want of wants) {
      const plan = relayPlan({ kind: 'oneAuthor', pubkey: want.pubkey }, ctx);
      for (const tier of plan.tiers) {
        for (const url of tier.groups.keys()) addGroup(groups, url, [want.pubkey]);
      }
    }
    await runGroups(
      lane,
      groups,
      (pubkeys) => ({
        kinds: [3],
        '#p': pubkeys,
        limit: FOLLOWER_CAP,
      }),
      1,
    );
  };

  /**
   * Private-feed kinds live on our read relays and on our connections'
   * write relays — outbox on the peer's real pubkey from the connection
   * payload, never on the burner (a burner has no relay list, and asking
   * strangers' relays would leak the alias tags). Peers whose NIP-65 list
   * we lack are asked for on ours, and a relay-list want is queued so the
   * next pass is outbox-correct.
   */
  const privateRelayGroups = (ctx: RoutingContext, peers: readonly string[]): Set<string> => {
    const urls = new Set(myReadRelays(ctx));
    for (const peer of peers) {
      const write = ctx.authorRelays.get(peer)?.write ?? [];
      if (write.length > 0) {
        for (const url of write) urls.add(url);
      } else {
        enqueue({ type: 'relayList', pubkey: peer }, 'background');
      }
    }
    return urls;
  };

  const runTagWants = async (
    lane: Lane,
    ctx: RoutingContext,
    subjects: string[],
    filterOf: (slice: string[]) => NostrFilter,
    size: number,
    peers: readonly string[] = [],
  ): Promise<void> => {
    if (subjects.length === 0) return;
    const groups: Groups = new Map();
    for (const url of privateRelayGroups(ctx, peers)) addGroup(groups, url, subjects);
    await runGroups(lane, groups, filterOf, size);
  };

  /** Re-run wants parked while our own routing was unresolved. */
  const reroute = (): void => {
    if (rerouteQueue.size === 0) return;
    for (const [key, q] of rerouteQueue) {
      if (!pending.has(key) && !inflight.has(key)) pending.set(key, q);
    }
    rerouteQueue.clear();
    if (timer === undefined && pending.size > 0) {
      timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    }
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // A flush already in progress owns the current batch; chain after it so
    // callers awaiting flush() see their own wants resolved.
    if (running) {
      await running;
      if (pending.size === 0) return;
    }
    if (pending.size === 0) return;

    const batch = [...pending.values()];
    pending.clear();
    for (const { want } of batch) inflight.add(wantKey(want));

    // Lanes run concurrently; the slot limiter is what orders them, so a
    // background poll cannot hold a slot an interactive avatar needs.
    running = Promise.all(
      LANES.map((lane) => runLane(lane, batch.filter((q) => q.lane === lane))),
    ).then(() => {
      const now = Date.now();
      const settled: EntityKey[] = [];
      const ctx = context();
      let selfResolved = false;
      for (const q of batch) {
        const want = q.want;
        const key = wantKey(want);
        inflight.delete(key);
        // An event miss while we still don't know the author's relays is
        // not a verdict — the trailing kind 10002 may unlock their outbox.
        const waitingOnAuthor =
          want.type === 'event' &&
          !target.getEvent(want.id) &&
          !!want.author &&
          !ctx.authorRelays.get(want.author);
        // Same rule for private wants while our own relay list has not
        // synced: they ran on the discovery fallback, which is not where
        // private kinds live. Park them until routing resolves — unless
        // the user's own relay list has settled empty, when the fallback
        // is all the routing there is.
        const waitingOnSelf =
          SELF_ROUTED.has(want.type) &&
          ctx.pubkey !== undefined &&
          selfResolvedFor !== ctx.pubkey &&
          ctx.myRelays.length === 0;
        if (waitingOnSelf) {
          rerouteQueue.set(key, q);
        } else {
          rerouteQueue.delete(key);
          if (want.type === 'relayList' && want.pubkey === ctx.pubkey) {
            // A definitive miss on our own list: the fallback is authoritative.
            if (!target.getReplaceable(REPLACEABLE_KIND.relayList, want.pubkey)) {
              selfResolvedFor = want.pubkey;
              selfResolved = true;
            }
          }
          if (!waitingOnAuthor) satisfiedAt.set(key, now);
          const entity = wantEntity(want);
          if (entity) settled.push(entity);
        }
      }
      // Settling after ingest, so a component never sees "asked and missing"
      // in the same tick that the answer arrived.
      target.settle(settled, now);
      if (selfResolved) reroute();
      running = undefined;
    });

    await running;
  };

  return {
    want: enqueue,

    promote: (want, lane) => {
      const queued = pending.get(wantKey(want));
      if (queued && rank(lane) < rank(queued.lane)) queued.lane = lane;
      else if (!queued) enqueue(want, lane);
    },

    drop: (want) => {
      pending.delete(wantKey(want));
      rerouteQueue.delete(wantKey(want));
    },

    reroute,

    flush,

    invalidate: () => {
      satisfiedAt.clear();
      selfResolvedFor = undefined;
    },

    reset: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      inflight.clear();
      satisfiedAt.clear();
      rerouteQueue.clear();
      selfResolvedFor = undefined;
      running = undefined;
    },
  };

};

export const scheduler: Scheduler = createScheduler();
