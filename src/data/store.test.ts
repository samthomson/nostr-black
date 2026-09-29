import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  addressableKey,
  createStore,
  eventKey,
  isAddressable,
  isReplaceable,
  keyForEvent,
  replaceableKey,
  supersedes,
} from './store';

const event = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1000,
  kind: 1,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
  ...over,
});

describe('kind classification', () => {
  it.each([
    [0, true, false],
    [3, true, false],
    [1, false, false],
    [9999, false, false],
    [10002, true, false],
    [19999, true, false],
    [20000, false, false],
    [30023, false, true],
    [39999, false, true],
    [40000, false, false],
  ])('kind %i', (kind, replaceable, addressable) => {
    expect(isReplaceable(kind)).toBe(replaceable);
    expect(isAddressable(kind)).toBe(addressable);
  });

  it('keys an addressable by its d tag, and by empty string when absent', () => {
    const withD = event({ kind: 30023, tags: [['d', 'my-post']] });
    expect(keyForEvent(withD)).toBe(addressableKey(30023, withD.pubkey, 'my-post'));
    expect(keyForEvent(event({ kind: 30023 }))).toBe(addressableKey(30023, 'b'.repeat(64), ''));
  });
});

describe('replaceable conflict rule', () => {
  it('prefers the newer event', () => {
    expect(supersedes(event({ created_at: 2 }), event({ created_at: 1 }))).toBe(true);
    expect(supersedes(event({ created_at: 1 }), event({ created_at: 2 }))).toBe(false);
  });

  it('breaks a created_at tie on the lower id (NIP-01)', () => {
    const low = event({ id: '0'.repeat(64), created_at: 5 });
    const high = event({ id: 'f'.repeat(64), created_at: 5 });
    expect(supersedes(low, high)).toBe(true);
    expect(supersedes(high, low)).toBe(false);
  });

  it('resolves the same way whichever relay answers first', () => {
    const older = event({ kind: 0, id: '1'.repeat(64), created_at: 10, content: 'old' });
    const newer = event({ kind: 0, id: '2'.repeat(64), created_at: 20, content: 'new' });

    const forwards = createStore();
    forwards.ingest([older], 'wss://a/');
    forwards.ingest([newer], 'wss://b/');

    const backwards = createStore();
    backwards.ingest([newer], 'wss://b/');
    backwards.ingest([older], 'wss://a/');

    expect(forwards.getReplaceable(0, older.pubkey)?.content).toBe('new');
    expect(backwards.getReplaceable(0, older.pubkey)?.content).toBe('new');
  });
});

describe('snapshot identity', () => {
  it('returns the same reference until the entity changes', () => {
    const store = createStore();
    const key = replaceableKey(0, 'b'.repeat(64));

    const empty = store.get(key);
    expect(store.get(key)).toBe(empty);

    store.ingest([event({ kind: 0, created_at: 10 })], 'wss://a/');
    const first = store.get(key);
    expect(first).not.toBe(empty);
    expect(store.get(key)).toBe(first);

    // An older duplicate is not a change.
    store.ingest([event({ kind: 0, id: 'f'.repeat(64), created_at: 5 })], 'wss://a/');
    expect(store.get(key)).toBe(first);

    store.ingest([event({ kind: 0, id: 'd'.repeat(64), created_at: 20 })], 'wss://a/');
    expect(store.get(key)).not.toBe(first);
  });

  it('gives every unknown key the identical empty object', () => {
    const store = createStore();
    expect(store.get('r:0:nobody')).toBe(store.get('e:missing'));
  });
});

describe('subscriptions', () => {
  it('notifies only the keys that changed', () => {
    const store = createStore();
    const onProfile = vi.fn();
    const onNote = vi.fn();
    const note = event({ id: '9'.repeat(64) });

    store.subscribe(replaceableKey(0, 'b'.repeat(64)), onProfile);
    store.subscribe(eventKey(note.id), onNote);

    store.ingest([event({ kind: 0 })], 'wss://a/');
    expect(onProfile).toHaveBeenCalledTimes(1);
    expect(onNote).not.toHaveBeenCalled();

    store.ingest([note], 'wss://a/');
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onProfile).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore();
    const listener = vi.fn();
    const off = store.subscribe(replaceableKey(0, 'b'.repeat(64)), listener);

    off();
    store.ingest([event({ kind: 0 })], 'wss://a/');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies once when a batch touches the same entity twice', () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(replaceableKey(0, 'b'.repeat(64)), listener);

    store.ingest(
      [event({ kind: 0, id: '1'.repeat(64), created_at: 1 }),
        event({ kind: 0, id: '2'.repeat(64), created_at: 2 })],
      'wss://a/',
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('settle', () => {
  it('separates "not asked yet" from "asked, and not there"', () => {
    const store = createStore();
    const key = replaceableKey(0, 'b'.repeat(64));

    expect(store.get(key).settledAt).toBeUndefined();
    store.settle([key], 5000);
    expect(store.get(key)).toEqual({ settledAt: 5000 });
  });

  it('keeps the event when a later fetch settles the same entity', () => {
    const store = createStore();
    const key = replaceableKey(0, 'b'.repeat(64));

    store.ingest([event({ kind: 0, content: 'hi' })], 'wss://a/');
    store.settle([key], 5000);

    expect(store.get(key).event?.content).toBe('hi');
    expect(store.get(key).settledAt).toBe(5000);
  });

  it('notifies subscribers so a spinner can stop on a miss', () => {
    const store = createStore();
    const listener = vi.fn();
    const key = replaceableKey(0, 'b'.repeat(64));

    store.subscribe(key, listener);
    store.settle([key], 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same timestamp again is not a change.
    store.settle([key], 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('provenance', () => {
  it('accumulates every relay that served the same event', () => {
    const store = createStore();
    const note = event({ id: '7'.repeat(64) });

    store.ingest([note], 'wss://a/');
    store.ingest([note], 'wss://b/');
    store.ingest([note], 'wss://a/');

    expect(store.get(eventKey(note.id)).foundOn).toEqual(['wss://a/', 'wss://b/']);
  });

  it('notifies subscribers when a later relay adds provenance', () => {
    const store = createStore();
    const note = event({ id: '7'.repeat(64) });
    const listener = vi.fn();

    store.ingest([note], 'wss://a/');
    store.subscribe(eventKey(note.id), listener);
    store.ingest([note], 'wss://b/');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get(eventKey(note.id)).foundOn).toEqual(['wss://a/', 'wss://b/']);
  });

  it('describes the event now held, not the one it replaced', () => {
    const store = createStore();
    const key = replaceableKey(0, 'b'.repeat(64));

    store.ingest([event({ kind: 0, id: '1'.repeat(64), created_at: 1 })], 'wss://old/');
    store.ingest([event({ kind: 0, id: '2'.repeat(64), created_at: 2 })], 'wss://new/');

    expect(store.get(key).foundOn).toEqual(['wss://new/']);
  });
});

describe('reference index', () => {
  it('indexes replies, reactions and quotes by their target', () => {
    const store = createStore();
    const target = '5'.repeat(64);

    store.ingest([
      event({ id: '1'.repeat(64), kind: 1, tags: [['e', target]] }),
      event({ id: '2'.repeat(64), kind: 7, tags: [['e', target]] }),
      event({ id: '3'.repeat(64), kind: 1111, tags: [['E', target]] }),
      event({ id: '4'.repeat(64), kind: 1, tags: [['q', target]] }),
      event({ id: '6'.repeat(64), kind: 1, tags: [['p', target]] }),
    ], 'wss://a/');

    expect([...store.getRefs(target)].sort()).toEqual([
      '1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64),
    ]);
  });

  it('notifies the target when a reply lands, so counts can move', () => {
    const store = createStore();
    const target = '5'.repeat(64);
    const listener = vi.fn();
    store.subscribe(eventKey(target), listener);

    store.ingest([event({ id: '1'.repeat(64), tags: [['e', target]] })], 'wss://a/');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns an empty set for an unreferenced id', () => {
    expect(createStore().getRefs('nothing').size).toBe(0);
  });
});

describe('queryByKind', () => {
  it('returns every stored event of that kind', () => {
    const store = createStore();
    const alice = 'a'.repeat(64);
    store.ingest([
      event({ id: '1'.repeat(64), pubkey: alice, kind: 3, tags: [['p', 'x'.repeat(64)]] }),
      event({ id: '2'.repeat(64), pubkey: 'c'.repeat(64), kind: 3, tags: [['p', alice]] }),
      event({ id: '3'.repeat(64), kind: 1 }),
    ], 'wss://a/');

    expect(store.queryByKind(3)).toHaveLength(2);
    expect(store.queryByKind(1)).toHaveLength(1);
  });
});

describe('summary', () => {
  it('counts held entities by class, ignoring settle-only keys', () => {
    const store = createStore();
    store.ingest([
      event({ id: '1'.repeat(64), kind: 1 }),
      event({ id: '2'.repeat(64), kind: 0 }),
      event({ id: '3'.repeat(64), kind: 30023, tags: [['d', 'a']] }),
    ], 'wss://a/');
    store.settle(['t:missing']);

    expect(store.summary()).toEqual({ events: 1, replaceable: 1, addressable: 1 });
  });
});

describe('queryByAuthors', () => {
  const store = createStore();
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);

  store.ingest([
    event({ id: '1'.repeat(64), pubkey: alice, kind: 1, created_at: 100 }),
    event({ id: '2'.repeat(64), pubkey: alice, kind: 1, created_at: 300 }),
    event({ id: '3'.repeat(64), pubkey: bob, kind: 1, created_at: 200 }),
    event({ id: '4'.repeat(64), pubkey: bob, kind: 7, created_at: 250 }),
    event({ id: '5'.repeat(64), pubkey: 'c'.repeat(64), kind: 1, created_at: 400 }),
  ], 'wss://a/');

  it('returns matching authors and kinds newest-first', () => {
    const got = store.queryByAuthors([alice, bob], [1]);
    expect(got.map((e) => e.created_at)).toEqual([300, 200, 100]);
  });

  it('honours the time range', () => {
    expect(store.queryByAuthors([alice, bob], [1], { since: 150, until: 250 })
      .map((e) => e.created_at)).toEqual([200]);
  });

  it('excludes authors and kinds not asked for', () => {
    const got = store.queryByAuthors([alice, bob], [1]);
    expect(got.some((e) => e.kind === 7)).toBe(false);
    expect(got.some((e) => e.pubkey === 'c'.repeat(64))).toBe(false);
  });
});

describe('ephemeral events', () => {
  it('are never stored', () => {
    const store = createStore();
    const auth = event({ kind: 22242, id: '8'.repeat(64) });
    store.ingest([auth], 'wss://a/');
    expect(store.getEvent(auth.id)).toBeUndefined();
  });
});

describe('restore', () => {
  it('puts the event and its provenance in one shot', () => {
    const store = createStore();
    const note = event({ id: '7'.repeat(64) });

    store.restore([{ event: note, foundOn: ['wss://a/', 'wss://b/'] }]);

    expect(store.getEvent(note.id)).toEqual(note);
    expect(store.get(eventKey(note.id)).foundOn).toEqual(['wss://a/', 'wss://b/']);
  });

  it('does not overwrite a newer event already in memory', () => {
    const store = createStore();
    const key = replaceableKey(0, 'b'.repeat(64));

    store.ingest([event({ kind: 0, id: '2'.repeat(64), created_at: 20, content: 'new' })], 'wss://live/');
    store.restore([{
      event: event({ kind: 0, id: '1'.repeat(64), created_at: 10, content: 'old' }),
      foundOn: ['wss://disk/'],
    }]);

    expect(store.get(key).event?.content).toBe('new');
    expect(store.get(key).foundOn).toEqual(['wss://live/']);
  });

  it('does not notify store-wide watchers — hydration is not a write', () => {
    const store = createStore();
    const watcher = { onIngest: vi.fn(), onClear: vi.fn() };
    store.watch(watcher);

    store.restore([{ event: event({ id: '7'.repeat(64) }), foundOn: ['wss://a/'] }]);

    expect(watcher.onIngest).not.toHaveBeenCalled();
    expect(store.getEvent('7'.repeat(64))).toBeDefined();
  });
});

describe('watch', () => {
  it('sees every ingested key, not just ones someone subscribed to', () => {
    const store = createStore();
    const watcher = { onIngest: vi.fn(), onClear: vi.fn() };
    store.watch(watcher);

    const note = event({ id: '9'.repeat(64) });
    store.ingest([note], 'wss://a/');

    expect(watcher.onIngest).toHaveBeenCalledWith([eventKey(note.id)]);
    expect(watcher.onClear).not.toHaveBeenCalled();
  });

  it('signals a wipe separately from an ingest', () => {
    const store = createStore();
    const watcher = { onIngest: vi.fn(), onClear: vi.fn() };
    store.watch(watcher);

    store.ingest([event({ id: '9'.repeat(64) })], 'wss://a/');
    store.clear();

    expect(watcher.onClear).toHaveBeenCalledTimes(1);
    expect(watcher.onIngest).toHaveBeenCalledTimes(1);
  });
});
