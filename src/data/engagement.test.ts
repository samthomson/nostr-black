import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { createStore } from './store';
import { engagementOf, reactionsOf, REACTION_CAP, tally } from './engagement';

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

describe('tally', () => {
  it('dedupes replies by event id', () => {
    const reply = event({ id: '2'.repeat(64), kind: 1 });
    const got = tally([reply, reply]);
    expect(got.replies).toBe(1);
  });

  it('counts NIP-10 and NIP-22 children together', () => {
    const got = tally([
      event({ id: '2'.repeat(64), kind: 1 }),
      event({ id: '3'.repeat(64), kind: 1111 }),
    ]);
    expect(got.replies).toBe(2);
  });

  it('reports the reply cap as a floor, not a number past what we have', () => {
    const flood = Array.from({ length: REACTION_CAP }, (_, i) =>
      event({
        id: `${i}`.padStart(64, '0'),
        kind: 1,
        pubkey: `${i}`.padStart(64, 'a'),
      }));
    const got = tally(flood);
    expect(got.replies).toBe(REACTION_CAP);
    expect(got.capped).toBe(true);
  });
});

describe('engagementOf', () => {
  it('reads whatever the store currently holds for the target', () => {
    const store = createStore();
    store.ingest([
      event({ id: '2'.repeat(64), kind: 1 }),
      event({ id: '3'.repeat(64), kind: 7, pubkey: BOB, content: '+' }),
    ], 'wss://a/');

    const got = engagementOf(store, TARGET);
    expect(got.replies).toBe(1);
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
    expect(reactionsOf(store, 'e'.repeat(64)).map((r) => r.pubkey)).toEqual(
      ['a'.repeat(64), 'c'.repeat(64), 'b'.repeat(64)],
    );
  });

  it('a kind 5 served later removes exactly the reaction it names', () => {
    const store = createStore();
    const mine = reaction('a'.repeat(64), '+', 200, '1'.repeat(64));
    store.ingest([mine], 'wss://mine/');
    store.ingest([{
      id: '4'.repeat(64), pubkey: 'a'.repeat(64), created_at: 300, kind: 5,
      content: '', tags: [['e', '1'.repeat(64)]], sig: 'f'.repeat(128),
    }], 'wss://relay/');
    expect(reactionsOf(store, 'e'.repeat(64))).toHaveLength(0);
  });
});
