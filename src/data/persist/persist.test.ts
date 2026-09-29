import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { createStore, eventKey, replaceableKey } from '@/data/store';
import { identityCodec, setCodec } from './codec';
import { ADDRESSABLE, closeDatabase, database, deleteDatabase, EVENTS, META, REPLACEABLE } from './db';
import { createPersister } from './persist';

const ALICE = 'a'.repeat(64);

const event = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: '1'.repeat(64),
  pubkey: ALICE,
  created_at: 1000,
  kind: 1,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
  ...over,
});

const note = (created_at: number, id: string): NostrEvent =>
  event({ id: id.padStart(64, '0'), created_at });

beforeEach(async () => {
  setCodec(identityCodec);
  await deleteDatabase();
});

afterEach(async () => {
  setCodec(identityCodec);
  vi.useRealTimers();
  await deleteDatabase();
});

const open = async (flushMs = 250) => {
  const target = createStore();
  const persister = createPersister(target, { flushMs, flushCount: 24, eventWindow: 3 });
  await persister.start();
  return { target, persister };
};

describe('write-behind', () => {
  it('does not write on the ingest path', async () => {
    const { target, persister } = await open(60_000);
    const n = event({ id: '2'.repeat(64) });

    target.ingest([n], 'wss://a/');

    const db = await database();
    expect(await db.get(EVENTS, eventKey(n.id))).toBeUndefined();

    await persister.flush();
    expect(await db.get(EVENTS, eventKey(n.id))).toBeDefined();
    await persister.stop();
  });

  it('flushes after the timer, not before', async () => {
    const { target, persister } = await open(40);
    const n = event({ id: '3'.repeat(64) });
    target.ingest([n], 'wss://a/');

    const db = await database();
    expect(await db.get(EVENTS, eventKey(n.id))).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await db.get(EVENTS, eventKey(n.id))).toBeDefined();
    await persister.stop();
  });

  it('flushes once the count threshold is reached', async () => {
    const { target, persister } = await open(60_000);

    const events = Array.from({ length: 24 }, (_, i) =>
      note(1000 + i, String(i + 1)));
    target.ingest(events, 'wss://a/');

    // The threshold flush is async; give it the microtask it needs.
    await vi.waitFor(async () => {
      const db = await database();
      expect(await db.count(EVENTS)).toBe(24);
    });
    await persister.stop();
  });

  it('does not persist a settle that found nothing', async () => {
    const { target, persister } = await open(60_000);
    const key = replaceableKey(0, ALICE);

    target.settle([key], 1);
    await persister.flush();

    const db = await database();
    expect(await db.get(REPLACEABLE, key)).toBeUndefined();
    await persister.stop();
  });

  it('writes replaceable and addressable to their own stores', async () => {
    const { target, persister } = await open(60_000);

    target.ingest([
      event({ kind: 0, id: '4'.repeat(64), content: '{"name":"a"}' }),
      event({ kind: 30023, id: '5'.repeat(64), tags: [['d', 'post']] }),
    ], 'wss://a/');
    await persister.flush();

    const db = await database();
    expect(await db.get(REPLACEABLE, replaceableKey(0, ALICE))).toBeDefined();
    expect(await db.get(ADDRESSABLE, `a:30023:${ALICE}:post`)).toBeDefined();
    expect(await db.count(EVENTS)).toBe(0);
    await persister.stop();
  });
});

describe('hydration', () => {
  it('restores events and provenance into a fresh store', async () => {
    const first = createStore();
    const writer = createPersister(first, { flushMs: 60_000 });
    await writer.start();

    const n = event({ id: '6'.repeat(64), content: 'cached' });
    first.ingest([n], 'wss://a/');
    first.ingest([n], 'wss://b/');
    await writer.flush();
    await writer.stop();
    await closeDatabase();

    const second = createStore();
    const reader = createPersister(second, { flushMs: 60_000 });
    await reader.start();

    expect(second.getEvent(n.id)?.content).toBe('cached');
    expect(second.get(eventKey(n.id)).foundOn).toEqual(['wss://a/', 'wss://b/']);
    await reader.stop();
  });

  it('loads every replaceable, but only the most recent regular events', async () => {
    const first = createStore();
    const writer = createPersister(first, { flushMs: 60_000, eventWindow: 3 });
    await writer.start();

    first.ingest([
      event({ kind: 0, id: 'a'.repeat(64), content: '{"name":"alice"}' }),
      note(1, '1'),
      note(2, '2'),
      note(3, '3'),
      note(4, '4'),
    ], 'wss://a/');
    await writer.flush();
    await writer.stop();
    await closeDatabase();

    const second = createStore();
    const reader = createPersister(second, { flushMs: 60_000, eventWindow: 3 });
    await reader.start();

    expect(second.getReplaceable(0, ALICE)?.content).toBe('{"name":"alice"}');
    expect(second.getEvent('1'.padStart(64, '0'))).toBeUndefined();
    expect(second.getEvent('2'.padStart(64, '0'))).toBeDefined();
    expect(second.getEvent('4'.padStart(64, '0'))).toBeDefined();
    await reader.stop();
  });

  it('keeps a separate window for reactions, so they do not evict feed notes', async () => {
    const first = createStore();
    const writer = createPersister(first, {
      flushMs: 60_000,
      eventWindow: 2,
      engagementWindow: 10,
    });
    await writer.start();

    first.ingest([
      note(1, '1'),
      event({ kind: 7, id: 'b'.repeat(64), content: '+' }),
      event({ kind: 7, id: 'c'.repeat(64), content: '+' }),
      event({ kind: 7, id: 'd'.repeat(64), content: '+' }),
      note(2, '2'),
      note(3, '3'),
    ], 'wss://a/');
    await writer.flush();
    await writer.stop();
    await closeDatabase();

    const second = createStore();
    const reader = createPersister(second, {
      flushMs: 60_000,
      eventWindow: 2,
      engagementWindow: 10,
    });
    await reader.start();

    expect(second.getEvent('1'.padStart(64, '0'))).toBeUndefined();
    expect(second.getEvent('2'.padStart(64, '0'))).toBeDefined();
    expect(second.getEvent('3'.padStart(64, '0'))).toBeDefined();
    expect(second.getEvent('b'.repeat(64))).toBeDefined();
    expect(second.getEvent('d'.repeat(64))).toBeDefined();
    await reader.stop();
  });

  it('goes through the codec on write and on read', async () => {
    setCodec({
      encode: async (record) => ({ wrapped: record }),
      decode: async (encoded) => (encoded as { wrapped: import('./codec').PersistedRecord }).wrapped,
    });

    const first = createStore();
    const writer = createPersister(first, { flushMs: 60_000 });
    await writer.start();
    const n = event({ id: '7'.repeat(64), content: 'boxed' });
    first.ingest([n], 'wss://a/');
    await writer.flush();

    const db = await database();
    const row = await db.get(EVENTS, eventKey(n.id));
    expect(row?.body).toEqual({ wrapped: { event: n, foundOn: ['wss://a/'] } });

    await writer.stop();
    await closeDatabase();

    const second = createStore();
    const reader = createPersister(second, { flushMs: 60_000 });
    await reader.start();
    expect(second.getEvent(n.id)?.content).toBe('boxed');
    await reader.stop();
  });

  it('does not let a disk copy overwrite a newer in-memory event', async () => {
    const first = createStore();
    const writer = createPersister(first, { flushMs: 60_000 });
    await writer.start();
    first.ingest([
      event({ kind: 0, id: '1'.repeat(64), created_at: 10, content: 'old' }),
    ], 'wss://disk/');
    await writer.flush();
    await writer.stop();
    await closeDatabase();

    const second = createStore();
    second.ingest([
      event({ kind: 0, id: '2'.repeat(64), created_at: 20, content: 'live' }),
    ], 'wss://live/');

    const reader = createPersister(second, { flushMs: 60_000 });
    await reader.start();

    expect(second.getReplaceable(0, ALICE)?.content).toBe('live');
    await reader.stop();
  });

  it('drops pending writes when the memory store is cleared, without a read-modify-write', async () => {
    const { target, persister } = await open(60_000);
    target.ingest([event({ id: '8'.repeat(64) })], 'wss://a/');
    target.clear();
    await persister.flush();

    const db = await database();
    expect(await db.get(EVENTS, eventKey('8'.repeat(64)))).toBeUndefined();
    await persister.stop();
  });

  it('wipe() empties every store', async () => {
    const { target, persister } = await open(60_000);
    target.ingest([event({ id: '8'.repeat(64) })], 'wss://a/');
    await persister.flush();

    await persister.wipe();

    const db = await database();
    expect(await db.count(EVENTS)).toBe(0);
    expect(await db.get(META, 'seq')).toBeUndefined();
    await persister.stop();
  });
});
