import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { createStore } from './store';
import { engagementOf, reactionsOf, REACTION_CAP } from './engagement';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const TARGET = 't'.repeat(64);

const event = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: over.id ?? '1'.repeat(64),
  pubkey: over.pubkey ?? ALICE,
  created_at: 1000,
  kind: over.kind ?? 1,
  tags: over.tags ?? [['e', TARGET]],
  content: over.content ?? '',
  sig: 'c'.repeat(128),
  ...over,
});

describe('engagementOf', () => {
  it('counts what the thread shows: direct children only', () => {
    const store = createStore();
    // A direct reply (marked) and a reaction — one reply.
    store.ingest([
      event({ id: '2'.repeat(64), kind: 1, tags: [['e', 'r'.repeat(64), '', 'root'], ['e', TARGET, '', 'reply']] }),
      event({ id: '3'.repeat(64), kind: 7, pubkey: BOB, content: '+' }),
    ], 'wss://a/');

    expect(engagementOf(store, TARGET).replies).toBe(1);
  });

  it('a reply-to-a-reply naming this note as root does not inflate the root count', () => {
    const store = createStore();
    const child = 'c'.repeat(64);
    store.ingest([
      // direct child of TARGET
      event({ id: child, kind: 1, tags: [['e', TARGET, '', 'reply']] }),
      // a reply to that child — carries TARGET as *root*, not reply
      event({ id: 'd'.repeat(64), kind: 1, tags: [['e', TARGET, '', 'root'], ['e', child, '', 'reply']] }),
    ], 'wss://a/');

    // the thread view shows one direct child; so must the count
    expect(engagementOf(store, TARGET).replies).toBe(1);
    // and the deep reply counts under its actual parent
    expect(engagementOf(store, child).replies).toBe(1);
  });

  it('counts NIP-10 and NIP-22 children together', () => {
    const store = createStore();
    store.ingest([
      event({ id: '2'.repeat(64), kind: 1 }),
      event({ id: '3'.repeat(64), kind: 1111 }),
    ], 'wss://a/');
    expect(engagementOf(store, TARGET).replies).toBe(2);
  });

  it('reports the reply cap as a floor, not a number past what we have', () => {
    const store = createStore();
    store.ingest(
      Array.from({ length: REACTION_CAP }, (_, i) =>
        event({
          id: `${i}`.padStart(64, '0'),
          kind: 1,
          pubkey: `${i}`.padStart(64, 'a'),
        })),
      'wss://a/',
    );
    const got = engagementOf(store, TARGET);
    expect(got.replies).toBe(REACTION_CAP);
    expect(got.capped).toBe(true);
  });
});


describe('reactionsOf merge', () => {
  const reaction = (pk: string, content: string, at: number, id: string): NostrEvent => ({
    id, pubkey: pk, created_at: at, kind: 7, content, tags: [['e', 'e'.repeat(64)]], sig: 'f'.repeat(128),
  });

  it('keeps my locally-published reaction when relays later serve theirs', () => {
    const store = createStore();
    const mine = reaction('a'.repeat(64), '+', 200, '1'.repeat(64));
    store.ingest([mine], 'wss://mine/');
    const theirs = [
      reaction('b'.repeat(64), '+', 100, '2'.repeat(64)),
      reaction('c'.repeat(64), '❤', 150, '3'.repeat(64)),
    ];
    store.ingest(theirs, 'wss://relay/');
    expect(reactionsOf(store, 'e'.repeat(64)).items.map((r) => r.pubkey)).toEqual(
      ['a'.repeat(64), 'c'.repeat(64), 'b'.repeat(64)],
    );
  });

  it('flags capped when the ref index holds a fetch-cap of reactions — the count is a floor', () => {
    const store = createStore();
    const flood = Array.from({ length: REACTION_CAP }, (_, i) => {
      const pk = String(i).padStart(64, 'a');
      return {
        id: `${i}`.padStart(64, '0'), pubkey: pk, created_at: 100 + i, kind: 7,
        content: '+', tags: [['e', 'e'.repeat(64)]], sig: 'f'.repeat(128),
      };
    });
    store.ingest(flood, 'wss://one/');
    const got = reactionsOf(store, 'e'.repeat(64));
    expect(got.items).toHaveLength(REACTION_CAP);
    expect(got.capped).toBe(true);
  });

  it('is not capped below the cap — an exact count is honest', () => {
    const store = createStore();
    store.ingest([{
      id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 100, kind: 7,
      content: '+', tags: [['e', 'e'.repeat(64)]], sig: 'f'.repeat(128),
    }], 'wss://one/');
    const got = reactionsOf(store, 'e'.repeat(64));
    expect(got.capped).toBe(false);
  });

  it('a kind 5 served later removes exactly the reaction it names', () => {
    const store = createStore();
    const mine = reaction('a'.repeat(64), '+', 200, '1'.repeat(64));
    store.ingest([mine], 'wss://mine/');
    store.ingest([{
      id: '4'.repeat(64), pubkey: 'a'.repeat(64), created_at: 300, kind: 5,
      content: '', tags: [['e', '1'.repeat(64)]], sig: 'f'.repeat(128),
    }], 'wss://relay/');
    expect(reactionsOf(store, 'e'.repeat(64)).items).toHaveLength(0);
  });
});
