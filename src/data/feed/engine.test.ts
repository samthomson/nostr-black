import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { RelayResult } from '@/net/net';
import type { RoutingContext } from '@/data/routing';
import { createStore } from '@/data/store';
import { createSlotLimiter } from '@/data/slots';
import { createFeedEngine, PAGE_LIMIT, type FeedEngine } from './engine';
import type { FeedSpec } from './spec';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

let seq = 0;
const note = (
  created_at: number,
  pubkey = ALICE,
  id = `${(seq += 1)}`.padStart(64, '0'),
): NostrEvent => ({
  id,
  pubkey,
  created_at,
  kind: 1,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
});

/** A fake relay: answers a window from a fixed corpus, like a real one. */
interface FakeRelay {
  events: NostrEvent[];
  eose?: boolean;
}

const build = (
  relays: Record<string, FakeRelay>,
  over: Partial<FeedSpec> = {},
  deps: { pageWaitMs?: number } = {},
) => {
  const store = createStore();

  const ctx: RoutingContext = {
    pubkey: 'e'.repeat(64),
    myRelays: [{ url: 'wss://mine/', read: true, write: true }],
    discovery: [],
    authorRelays: {
      get: (pubkey) =>
        pubkey === ALICE || pubkey === BOB
          ? { read: [], write: Object.keys(relays) }
          : undefined,
    },
  };

  const query = vi.fn(async (url: string, filters: NostrFilter[]): Promise<RelayResult> => {
    const relay = relays[url];
    const { until, since, limit = 100 } = filters[0];

    const matching = relay.events
      .filter((e) => (until === undefined || e.created_at <= until))
      .filter((e) => (since === undefined || e.created_at >= since))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);

    return { url, events: matching, eose: relay.eose ?? true };
  });

  const spec: FeedSpec = {
    id: 'test',
    kinds: [1],
    authors: () => [ALICE, BOB],
    routing: 'outbox',
    ...over,
  };

  const engine = createFeedEngine(spec, {
    target: store,
    context: () => ctx,
    limiter: createSlotLimiter(),
    query,
    ...deps,
  });

  return { engine, store, query, ctx };
};

const rendered = (engine: FeedEngine) =>
  engine.getState().pages.flatMap((p) => p.events).map((e) => e.created_at);

beforeEach(() => {
  seq = 0;
});

describe('sealed pages', () => {
  it('renders the first page newest-first', async () => {
    const { engine } = build({
      'wss://a/': { events: [note(500), note(300), note(100)] },
    });

    await engine.loadMore();
    expect(rendered(engine)).toEqual([500, 300, 100]);
  });

  it('never reorders or duplicates across pages', async () => {
    // Enough events that no relay can answer the whole feed at once.
    const events = Array.from({ length: 250 }, (_, i) => note(1000 - i));
    const { engine } = build({ 'wss://a/': { events } });

    await engine.loadMore();
    const firstPage = [...rendered(engine)];
    await engine.loadMore();
    await engine.loadMore();

    const all = rendered(engine);
    // The first page is still exactly where and what it was.
    expect(all.slice(0, firstPage.length)).toEqual(firstPage);
    // Strictly descending overall: nothing was inserted out of order.
    expect([...all].sort((x, y) => y - x)).toEqual(all);
    expect(new Set(all).size).toBe(all.length);
  });

  it('holds back events a relay gave us but could not prove complete', async () => {
    const { engine } = build({
      // Deep but capped at the limit; only complete down to its oldest.
      'wss://deep/': { events: Array.from({ length: 100 }, (_, i) => note(1000 - i)) },
      // Exhausted, and its events sit below where deep stops.
      'wss://old/': { events: [note(500), note(400)] },
    });

    await engine.loadMore();

    // deep proves coverage only down to 901, so old's 500 and 400 are in
    // hand but cannot be shown yet — they sit in a range no relay has
    // confirmed is complete.
    expect(rendered(engine)).not.toContain(500);
    expect(Math.min(...rendered(engine))).toBeGreaterThanOrEqual(901);

    // Paging down eventually reaches them.
    for (let i = 0; i < 5 && !rendered(engine).includes(500); i += 1) {
      await engine.loadMore();
    }
    expect(rendered(engine)).toContain(500);
  });

  it('loses nothing when a page is clipped short of the watermark', async () => {
    // One relay, 100 events: the watermark covers all of them but a page
    // only holds PAGE_LIMIT, so the rest must arrive on the next page.
    const events = Array.from({ length: 100 }, (_, i) => note(1000 - i));
    const { engine } = build({ 'wss://a/': { events } });

    await engine.loadMore();
    await engine.loadMore();

    const shown = rendered(engine);
    expect(shown).toHaveLength(100);
    expect(shown[0]).toBe(1000);
    expect(shown.at(-1)).toBe(901);
    expect(new Set(shown).size).toBe(100);
  });

  it('caps a page at the page limit', async () => {
    const events = Array.from({ length: 100 }, (_, i) => note(1000 - i));
    const { engine } = build({ 'wss://a/': { events } });

    await engine.loadMore();
    expect(engine.getState().pages[0].events).toHaveLength(PAGE_LIMIT);
  });

  it('stops when every relay is exhausted', async () => {
    const { engine } = build({ 'wss://a/': { events: [note(500), note(400)] } });

    await engine.loadMore();
    expect(engine.getState().exhausted).toBe(true);

    const before = rendered(engine);
    await engine.loadMore();
    expect(rendered(engine)).toEqual(before);
  });

  it('does not advance the cursor when no relay answered', async () => {
    const { engine } = build({ 'wss://dead/': { events: [], eose: false } });

    const cursorBefore = engine.getState().cursor;
    await engine.loadMore();

    expect(engine.getState().cursor).toBe(cursorBefore);
    expect(engine.getState().degraded).toEqual(['wss://dead/']);
    expect(engine.getState().exhausted).toBe(false);
  });

  it('counts an attempt even when there was nowhere to ask', async () => {
    // Nobody's relay list is known, so outbox routing yields no relays.
    const { engine, ctx, query } = build({ 'wss://a/': { events: [note(500)] } });
    ctx.authorRelays = { get: () => undefined };

    await engine.loadMore();
    await engine.loadMore();

    expect(query).not.toHaveBeenCalled();
    // Untried and tried-empty must be distinguishable, or a caller that
    // retries on "no pages" will spin.
    expect(engine.getState().attempts).toBe(2);
    expect(engine.getState().exhausted).toBe(false);
  });

  it('counts attempts so a caller can tell untried from tried-empty', async () => {
    const { engine } = build({ 'wss://a/': { events: [note(500)] } });

    expect(engine.getState().attempts).toBe(0);
    await engine.loadMore();
    expect(engine.getState().attempts).toBe(1);

    // Exhausted, so this one short-circuits and is not an attempt.
    await engine.loadMore();
    expect(engine.getState().attempts).toBe(1);
  });

  it('dedupes an event served by two relays', async () => {
    const shared = note(500, ALICE, 'f'.repeat(64));
    const { engine } = build({
      'wss://a/': { events: [shared, note(400)] },
      'wss://b/': { events: [shared, note(300)] },
    });

    await engine.loadMore();
    const ids = engine.getState().pages[0].events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores events from authors the spec did not ask for', async () => {
    const stranger = 'd'.repeat(64);
    const { engine } = build({
      'wss://a/': { events: [note(500), note(450, stranger), note(400, BOB)] },
    });

    await engine.loadMore();
    expect(rendered(engine)).toEqual([500, 400]);
  });

  it('puts everything it received into the store, including held-back events', async () => {
    const { engine, store } = build({
      'wss://deep/': { events: Array.from({ length: 100 }, (_, i) => note(1000 - i)) },
      'wss://old/': { events: [note(500)] },
    });

    await engine.loadMore();

    // Below the floor, so not rendered — but held, and stamped with the
    // relay that served it, which is what engagement routing needs.
    const held = store.queryByAuthors([ALICE], [1], { until: 500, since: 500 })[0];
    expect(held).toBeDefined();
    expect(store.get(`e:${held.id}`).foundOn).toEqual(['wss://old/']);
  });

  it('does not fetch at all when the spec has no authors', async () => {
    const { engine, query } = build({ 'wss://a/': { events: [note(500)] } }, {
      authors: () => [],
    });

    await engine.loadMore();
    expect(query).not.toHaveBeenCalled();
    expect(rendered(engine)).toEqual([]);
  });

  it('asks each relay only about the authors that declared it', async () => {
    const { engine, query } = build({ 'wss://a/': { events: [note(500)] } });

    await engine.loadMore();
    expect(query.mock.calls[0][1][0].authors).toEqual([ALICE, BOB]);
  });
});

describe('forward pagination', () => {
  it('buffers new notes instead of inserting them', async () => {
    const relay: FakeRelay = { events: [note(500), note(400)] };
    const { engine } = build({ 'wss://a/': relay });

    await engine.loadMore();
    const onScreen = [...rendered(engine)];

    relay.events = [note(900), note(800), ...relay.events];
    await engine.poll();

    // Nothing moved. The new notes wait to be asked for.
    expect(rendered(engine)).toEqual(onScreen);
    expect(engine.getState().pending.map((e) => e.created_at).sort((a, b) => b - a))
      .toEqual([900, 800]);
  });

  it('puts accepted notes at the top, newest-first', async () => {
    const relay: FakeRelay = { events: [note(500), note(400)] };
    const { engine } = build({ 'wss://a/': relay });

    await engine.loadMore();
    relay.events = [note(800), note(900), ...relay.events];
    await engine.poll();
    engine.acceptPending();

    expect(rendered(engine)).toEqual([900, 800, 500, 400]);
    expect(engine.getState().pending).toEqual([]);
    expect(engine.getState().ceiling).toBe(900);
  });

  it('never buffers something already on screen', async () => {
    const relay: FakeRelay = { events: [note(500), note(400)] };
    const { engine } = build({ 'wss://a/': relay });

    await engine.loadMore();
    await engine.poll();
    await engine.poll();

    expect(engine.getState().pending).toEqual([]);
  });

  it('does not buffer the same note twice across polls', async () => {
    const relay: FakeRelay = { events: [note(500)] };
    const { engine } = build({ 'wss://a/': relay });

    await engine.loadMore();
    relay.events = [note(900), ...relay.events];
    await engine.poll();
    await engine.poll();

    expect(engine.getState().pending).toHaveLength(1);
  });

  it('re-seals from the top rather than stitching a gap bigger than a page', async () => {
    const relay: FakeRelay = { events: [note(500), note(400)] };
    const { engine } = build({ 'wss://a/': relay });

    await engine.loadMore();

    // Away long enough that far more than a page accumulated.
    const flood = Array.from({ length: PAGE_LIMIT + 20 }, (_, i) => note(10_000 - i));
    relay.events = [...flood, ...relay.events];
    await engine.poll();

    // Not stitched onto a stale view: the feed starts again from the top.
    expect(engine.getState().pending).toEqual([]);
    expect(engine.getState().pages).toHaveLength(1);
    expect(rendered(engine)[0]).toBe(10_000);
  });

  it('does nothing before a first page exists', async () => {
    const { engine, query } = build({ 'wss://a/': { events: [note(500)] } });

    await engine.poll();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('hydrateFromStore', () => {
  it('seals a first page from what the store already holds', () => {
    const { engine, store } = build({ 'wss://a/': { events: [] } });
    store.ingest([note(500), note(400), note(300, BOB)], 'wss://disk/');

    expect(engine.hydrateFromStore()).toBe(true);
    expect(rendered(engine)).toEqual([500, 400, 300]);
    expect(engine.getState().exhausted).toBe(false);
    expect(engine.getState().cursor).toBeGreaterThan(500);
    expect(engine.getState().ceiling).toBe(500);
  });

  it('does not claim a seed as completeness, so loadMore still walks down', async () => {
    const relay: FakeRelay = { events: [note(500), note(400), note(200), note(100)] };
    const { engine, store } = build({ 'wss://a/': relay });
    store.ingest([note(500), note(400)], 'wss://disk/');

    engine.hydrateFromStore();
    await engine.loadMore();

    expect(rendered(engine)).toEqual([500, 400, 200, 100]);
  });

  it('puts newer notes on screen after a disk seed — there is no reading position yet', async () => {
    const relay: FakeRelay = { events: [note(900), note(500)] };
    const { engine, store } = build({ 'wss://a/': relay });
    store.ingest([note(500)], 'wss://disk/');

    engine.hydrateFromStore();
    await engine.poll();

    expect(rendered(engine)).toEqual([900, 500]);
    expect(engine.getState().pending).toEqual([]);
  });

  it('does nothing when the store has no matching notes', () => {
    const { engine } = build({ 'wss://a/': { events: [] } });
    expect(engine.hydrateFromStore()).toBe(false);
    expect(engine.getState().pages).toEqual([]);
    expect(engine.getState().attempts).toBe(0);
  });

  it('does not reseal a feed that already has pages', async () => {
    const { engine, store } = build({
      'wss://a/': { events: [note(500)] },
    });

    await engine.loadMore();
    store.ingest([note(400)], 'wss://disk/');

    expect(engine.hydrateFromStore()).toBe(false);
    expect(rendered(engine)).toEqual([500]);
  });
});

describe('page wait', () => {
  it('clears loading after the wait even if leftover relays hang', async () => {
    vi.useFakeTimers();
    try {
      const { engine, query } = build(
        {
          'wss://a/': { events: [note(500)] },
          'wss://b/': { events: [note(400)] },
        },
        {},
        { pageWaitMs: 40 },
      );
      query.mockImplementation(async (url) => {
        if (url === 'wss://b/') return new Promise(() => {});
        return { url, events: [note(500)], eose: true };
      });

      const done = engine.loadMore();
      await vi.advanceTimersByTimeAsync(50);
      await done;

      expect(engine.getState().loading).toBe(false);
      expect(rendered(engine)).toEqual([500]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait forever when no relay answers', async () => {
    vi.useFakeTimers();
    try {
      const { engine, query } = build(
        { 'wss://a/': { events: [note(500)] } },
        {},
        { pageWaitMs: 40 },
      );
      query.mockImplementation(() => new Promise(() => {}));

      const done = engine.loadMore();
      await vi.advanceTimersByTimeAsync(90);
      await done;

      expect(engine.getState().loading).toBe(false);
      expect(engine.getState().attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seals with arrived relays instead of waiting on a hung one', async () => {
    vi.useFakeTimers();
    try {
      const { engine, query } = build(
        {
          'wss://a/': { events: [note(500)] },
          'wss://b/': { events: [note(400)] },
        },
        {},
        { pageWaitMs: 40 },
      );
      query.mockImplementation(async (url) => {
        if (url === 'wss://b/') return new Promise(() => {});
        return { url, events: [note(500)], eose: true };
      });

      const done = engine.loadMore();
      await vi.advanceTimersByTimeAsync(50);
      await done;

      expect(rendered(engine)).toEqual([500]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds the first page when a late outbox has more recent notes', async () => {
    vi.useFakeTimers();
    try {
      const { engine, query } = build(
        {
          'wss://a/': { events: [note(100), note(50)] },
          'wss://b/': { events: [note(900, BOB), note(800, BOB)] },
        },
        {},
        { pageWaitMs: 40 },
      );
      query.mockImplementation(async (url) => {
        if (url === 'wss://b/') {
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
          return { url, events: [note(900, BOB), note(800, BOB)], eose: true };
        }
        return { url, events: [note(100), note(50)], eose: true };
      });

      const done = engine.loadMore();
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(rendered(engine)).toEqual([100, 50]);
      expect(engine.getState().exhausted).toBe(false);

      await vi.advanceTimersByTimeAsync(50);
      expect(rendered(engine)).toEqual([900, 800, 100, 50]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds the first page with notes that arrive after the wait', async () => {
    vi.useFakeTimers();
    try {
      const { engine, query } = build(
        {
          'wss://a/': { events: [note(500)] },
          'wss://b/': { events: [note(900, BOB)] },
        },
        {},
        { pageWaitMs: 40 },
      );
      query.mockImplementation(async (url) => {
        if (url === 'wss://b/') {
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
          return { url, events: [note(900, BOB)], eose: true };
        }
        return { url, events: [note(500)], eose: true };
      });

      const done = engine.loadMore();
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(rendered(engine)).toEqual([500]);
      expect(engine.getState().pending).toEqual([]);

      await vi.advanceTimersByTimeAsync(50);
      expect(rendered(engine)).toEqual([900, 500]);
      expect(engine.getState().pending).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reset', () => {
  it('clears pages and lets the feed rebuild', async () => {
    const { engine } = build({ 'wss://a/': { events: [note(500), note(400)] } });

    await engine.loadMore();
    engine.reset();

    expect(engine.getState().pages).toEqual([]);
    expect(engine.getState().exhausted).toBe(false);
    expect(engine.getState().attempts).toBe(0);

    await engine.loadMore();
    expect(rendered(engine)).toEqual([500, 400]);
  });
});

describe('subscribers', () => {
  it('is notified when a page seals', async () => {
    const { engine } = build({ 'wss://a/': { events: [note(500)] } });
    const listener = vi.fn();

    engine.subscribe(listener);
    await engine.loadMore();

    expect(listener).toHaveBeenCalled();
    expect(engine.getState().pages).toHaveLength(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const { engine } = build({ 'wss://a/': { events: [note(500)] } });
    const listener = vi.fn();

    engine.subscribe(listener)();
    await engine.loadMore();

    expect(listener).not.toHaveBeenCalled();
  });
});
