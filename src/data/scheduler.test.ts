import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { RelayList } from '@/lib/outbox';
import type { RoutingContext } from './routing';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
vi.mock('@/net/net', () => ({ queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])) }));

const { createScheduler, wantEntity } = await import('./scheduler');
const { createStore } = await import('./store');
const { createSlotLimiter } = await import('./slots');

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const ME = 'e'.repeat(64);

const profileEvent = (pubkey: string, name: string): NostrEvent => ({
  id: pubkey.slice(0, 63) + '0',
  pubkey,
  created_at: 1000,
  kind: 0,
  tags: [],
  content: JSON.stringify({ name }),
  sig: 'c'.repeat(128),
});

const relayListEvent = (pubkey: string, write: string[]): NostrEvent => ({
  id: pubkey.slice(0, 63) + '1',
  pubkey,
  created_at: 1000,
  kind: 10002,
  tags: write.map((url) => ['r', url, 'write']),
  content: '',
  sig: 'c'.repeat(128),
});

/** A routing world with no author relay lists unless seeded. */
const world = (over: Partial<RoutingContext> = {}) => {
  const lists = new Map<string, RelayList>();
  const ctx: RoutingContext = {
    pubkey: ME,
    myRelays: [{ url: 'wss://mine/', read: true, write: true }],
    discovery: ['wss://discovery/'],
    authorRelays: { get: (pubkey) => lists.get(pubkey) },
    ...over,
  };
  return { ctx, lists };
};

const build = (over: Partial<RoutingContext> = {}) => {
  const { ctx, lists } = world(over);
  const store = createStore();
  const scheduler = createScheduler(store, () => ctx, createSlotLimiter());
  return { scheduler, store, lists, ctx };
};

/** What went to each relay: url → the author sets it was asked about. */
const asked = () =>
  queryRelay.mock.calls.map(([url, filters]) => ({
    url,
    kinds: filters[0].kinds,
    authors: [...(filters[0].authors ?? [])].sort(),
  }));

/** Only the requests for one kind — a profile batch also trails relay-list lookups. */
const askedFor = (kind: number) => asked().filter((a) => a.kinds?.includes(kind));

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
});

describe('coalescing', () => {
  it('collapses many wants for the same pubkey into one request', async () => {
    const { scheduler } = build();

    for (let i = 0; i < 50; i += 1) scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toEqual([{ url: 'wss://mine/', kinds: [0], authors: [ALICE] }]);
  });

  it('merges different pubkeys into a single filter per relay', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    scheduler.want({ type: 'profile', pubkey: BOB }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toEqual([{ url: 'wss://mine/', kinds: [0], authors: [ALICE, BOB].sort() }]);
  });

  it('does not re-request something already satisfied', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();
    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toHaveLength(1);
  });

  it('does not queue a want that is already in flight', async () => {
    const { scheduler } = build();
    let release: (events: NostrEvent[]) => void = () => {};
    queryRelay.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    const first = scheduler.flush();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    release([]);
    await first;
    await scheduler.flush();

    expect(askedFor(0)).toHaveLength(1);
  });

  it('forgets a want that was dropped before the batch went out', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    scheduler.want({ type: 'profile', pubkey: BOB }, 'interactive');
    scheduler.drop({ type: 'profile', pubkey: BOB });
    await scheduler.flush();

    expect(askedFor(0)).toEqual([{ url: 'wss://mine/', kinds: [0], authors: [ALICE] }]);
  });

  it('splits an oversized author list rather than sending one huge filter', async () => {
    const { scheduler } = build();

    for (let i = 0; i < 450; i += 1) {
      scheduler.want({ type: 'profile', pubkey: i.toString(16).padStart(64, '0') }, 'prefetch');
    }
    await scheduler.flush();

    const sizes = askedFor(0).map((a) => a.authors.length).sort((a, b) => b - a);
    expect(sizes).toEqual([200, 200, 50]);
  });
});

describe('outbox routing', () => {
  it('asks an author\'s own write relays when their relay list is known', async () => {
    const { scheduler, lists } = build();
    lists.set(ALICE, { read: [], write: ['wss://alice/'] });

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toEqual([{ url: 'wss://alice/', kinds: [0], authors: [ALICE] }]);
  });

  it('falls back to our own relays for an author we cannot route yet', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toEqual([{ url: 'wss://mine/', kinds: [0], authors: [ALICE] }]);
  });

  it('queues the relay list for an unroutable author so the next lookup is outbox-correct', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();
    queryRelay.mockClear();
    await scheduler.flush();

    expect(asked()).toEqual([{ url: 'wss://mine/', kinds: [10002], authors: [ALICE] }]);
  });

  it('splits a mixed batch by what it can route, one request per relay', async () => {
    const { scheduler, lists } = build();
    lists.set(ALICE, { read: [], write: ['wss://alice/'] });

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    scheduler.want({ type: 'profile', pubkey: BOB }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0).sort((a, b) => a.url.localeCompare(b.url))).toEqual([
      { url: 'wss://alice/', kinds: [0], authors: [ALICE] },
      { url: 'wss://mine/', kinds: [0], authors: [BOB] },
    ]);
  });

  it('never looks for someone else\'s relay list on a discovery relay', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'relayList', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(asked().map((a) => a.url)).toEqual(['wss://mine/']);
  });

  it('bootstraps our own identity against discovery as well as our relays', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ME }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0).map((a) => a.url).sort()).toEqual(['wss://discovery/', 'wss://mine/']);
    expect(askedFor(0).every((a) => a.authors[0] === ME)).toBe(true);
  });

  it('asks a relay only about the authors that declared it', async () => {
    const { scheduler, lists } = build();
    lists.set(ALICE, { read: [], write: ['wss://shared/', 'wss://alice/'] });
    lists.set(BOB, { read: [], write: ['wss://shared/'] });

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    scheduler.want({ type: 'profile', pubkey: BOB }, 'interactive');
    await scheduler.flush();

    const byUrl = new Map(askedFor(0).map((a) => [a.url, a.authors]));
    expect(byUrl.get('wss://shared/')).toEqual([ALICE, BOB].sort());
    expect(byUrl.get('wss://alice/')).toEqual([ALICE]);
  });
});

describe('results', () => {
  it('ingests into the store under the relay that served them', async () => {
    const { scheduler, store } = build();
    queryRelay.mockResolvedValue([profileEvent(ALICE, 'alice')]);

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(store.getReplaceable(0, ALICE)?.content).toContain('alice');
    expect(store.get(wantEntity({ type: 'profile', pubkey: ALICE })!).foundOn).toEqual(['wss://mine/']);
  });

  it('settles the entity so a miss stops looking pending', async () => {
    const { scheduler, store } = build();
    const key = wantEntity({ type: 'profile', pubkey: ALICE })!;

    expect(store.get(key).settledAt).toBeUndefined();
    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(store.get(key).event).toBeUndefined();
    expect(store.get(key).settledAt).toBeGreaterThan(0);
  });

  it('has the event in the store before the entity is settled', async () => {
    const { scheduler, store } = build();
    queryRelay.mockResolvedValue([profileEvent(ALICE, 'alice')]);
    const key = wantEntity({ type: 'profile', pubkey: ALICE })!;

    const seen: { event: boolean; settled: boolean }[] = [];
    store.subscribe(key, () => {
      const state = store.get(key);
      seen.push({ event: !!state.event, settled: state.settledAt !== undefined });
    });

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    // Never "settled with nothing" while the answer was already in hand.
    expect(seen.some((s) => s.settled && !s.event)).toBe(false);
  });

  it('routes by a relay list it ingested moments earlier', async () => {
    const { scheduler, store } = build();
    const lists = new Map<string, NostrEvent>([[ALICE, relayListEvent(ALICE, ['wss://alice/'])]]);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(10002) ? [lists.get(ALICE)!] : []);

    scheduler.want({ type: 'relayList', pubkey: ALICE }, 'interactive');
    await scheduler.flush();
    expect(store.getReplaceable(10002, ALICE)).toBeDefined();
  });

  it('reset makes a satisfied want fetchable again', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();
    scheduler.reset();
    scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    expect(askedFor(0)).toHaveLength(2);
  });
});

describe('event wants', () => {
  it('asks by id on the hint and our relays, not as a firehose', async () => {
    const { scheduler } = build();
    const id = '1'.repeat(64);

    scheduler.want({ type: 'event', id, hints: ['wss://hint/'] }, 'interactive');
    await scheduler.flush();

    const calls = queryRelay.mock.calls.filter(([, filters]) => filters[0].ids);
    expect(calls.map(([url]) => url).sort()).toEqual(['wss://hint/', 'wss://mine/']);
    expect(calls.every(([, filters]) => filters[0].ids?.[0] === id)).toBe(true);
  });
});

describe('engagement wants', () => {
  it('asks each relay only about the notes it served', async () => {
    const { scheduler, store } = build();
    const a = '1'.repeat(64);
    const b = '2'.repeat(64);

    store.ingest([
      { id: a, pubkey: ALICE, created_at: 1, kind: 1, tags: [], content: '', sig: 'c'.repeat(128) },
    ], 'wss://one/');
    store.ingest([
      { id: b, pubkey: BOB, created_at: 1, kind: 1, tags: [], content: '', sig: 'c'.repeat(128) },
    ], 'wss://two/');

    scheduler.want({ type: 'engagement', target: a }, 'prefetch');
    scheduler.want({ type: 'engagement', target: b }, 'prefetch');
    await scheduler.flush();

    const byUrl = Object.fromEntries(
      queryRelay.mock.calls
        .filter(([, filters]) => filters[0]['#e'])
        .map(([url, filters]) => [url, [...(filters[0]['#e'] ?? [])].sort()]),
    );

    expect(byUrl['wss://one/']).toEqual([a]);
    expect(byUrl['wss://two/']).toEqual([b]);
    expect(byUrl['wss://mine/']).toBeUndefined();
  });

  it('falls back to our relays when a note has no provenance yet', async () => {
    const { scheduler, store } = build();
    const a = '1'.repeat(64);
    store.ingest([
      { id: a, pubkey: ALICE, created_at: 1, kind: 1, tags: [], content: '', sig: 'c'.repeat(128) },
    ], 'wss://one/');
    // Drop provenance the way a restore without foundOn would look.
    store.clear();
    store.restore([{
      event: { id: a, pubkey: ALICE, created_at: 1, kind: 1, tags: [], content: '', sig: 'c'.repeat(128) },
      foundOn: [],
    }]);

    scheduler.want({ type: 'engagement', target: a }, 'interactive');
    await scheduler.flush();

    const urls = queryRelay.mock.calls
      .filter(([, filters]) => filters[0]['#e']?.[0] === a)
      .map(([url]) => url);
    expect(urls).toContain('wss://mine/');
  });
});

describe('thread wants', () => {
  it('asks found-on relays and the root author inbox, not a firehose', async () => {
    const { scheduler, store, lists } = build();
    const parent = '1'.repeat(64);
    lists.set(ALICE, { read: ['wss://alice-in/'], write: ['wss://alice-out/'] });
    store.ingest([
      { id: parent, pubkey: ALICE, created_at: 1, kind: 1, tags: [], content: '', sig: 'c'.repeat(128) },
    ], 'wss://found/');

    scheduler.want({ type: 'thread', parent, author: ALICE }, 'interactive');
    await scheduler.flush();

    const threadCalls = queryRelay.mock.calls.filter(([, filters]) =>
      filters[0].kinds?.includes(1111) && filters[0]['#e']);
    expect(threadCalls.map(([url]) => url).sort()).toEqual(['wss://alice-in/', 'wss://found/']);
    expect(threadCalls.every(([, filters]) => filters[0]['#e']?.[0] === parent)).toBe(true);
    expect(threadCalls.some(([url]) => url === 'wss://alice-out/' || url === 'wss://mine/')).toBe(false);
  });
});

describe('authorNotes wants', () => {
  it('asks the author outbox for their notes', async () => {
    const { scheduler, lists } = build();
    lists.set(ALICE, { read: [], write: ['wss://alice/'] });

    scheduler.want({ type: 'authorNotes', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    const calls = queryRelay.mock.calls.filter(([, filters]) => filters[0].kinds?.includes(1));
    expect(calls.map(([url]) => url)).toEqual(['wss://alice/', 'wss://mine/']);
    expect(calls[0][1][0].authors).toEqual([ALICE]);
  });

  it('asks the logged-in user’s write relays for their own notes', async () => {
    const { scheduler } = build();

    scheduler.want({ type: 'authorNotes', pubkey: ME }, 'interactive');
    await scheduler.flush();

    const calls = queryRelay.mock.calls.filter(([, filters]) => filters[0].kinds?.includes(1));
    expect(calls.map(([url]) => url)).toEqual(['wss://mine/']);
    expect(calls[0][1][0].authors).toEqual([ME]);
  });
});

describe('followers wants', () => {
  it('asks kind 3 tagged with this pubkey, not the author outbox only', async () => {
    const { scheduler, lists } = build();
    lists.set(ALICE, { read: [], write: ['wss://alice/'] });

    scheduler.want({ type: 'followers', pubkey: ALICE }, 'interactive');
    await scheduler.flush();

    const calls = queryRelay.mock.calls.filter(([, filters]) => filters[0].kinds?.includes(3));
    expect(calls.map(([url]) => url).sort()).toEqual(['wss://alice/', 'wss://mine/']);
    expect(calls.every(([, filters]) => filters[0]['#p']?.[0] === ALICE)).toBe(true);
  });
});

describe('debounce', () => {
  it('batches wants that arrive within the window into one request', async () => {
    vi.useFakeTimers();
    try {
      const { scheduler } = build();

      scheduler.want({ type: 'profile', pubkey: ALICE }, 'interactive');
      await vi.advanceTimersByTimeAsync(40);
      scheduler.want({ type: 'profile', pubkey: BOB }, 'interactive');
      await vi.advanceTimersByTimeAsync(100);

      expect(askedFor(0)).toEqual([
        { url: 'wss://mine/', kinds: [0], authors: [ALICE, BOB].sort() },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
