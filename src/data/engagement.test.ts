import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { createStore } from './store';
import { engagementOf, REACTION_CAP, tally } from './engagement';

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

  it('dedupes reactions by pubkey, not event id', () => {
    const got = tally([
      event({ id: '2'.repeat(64), kind: 7, pubkey: ALICE, content: '+' }),
      event({ id: '3'.repeat(64), kind: 7, pubkey: ALICE, content: '+' }),
      event({ id: '4'.repeat(64), kind: 7, pubkey: BOB, content: '+' }),
    ]);
    expect(got.reactions).toBe(2);
  });

  it('counts NIP-25 "-" as a downvote, not a like', () => {
    const got = tally([
      event({ id: '2'.repeat(64), kind: 7, pubkey: ALICE, content: '-' }),
      event({ id: '3'.repeat(64), kind: 7, pubkey: BOB, content: '+' }),
    ]);
    expect(got.downvotes).toBe(1);
    expect(got.reactions).toBe(1);
  });

  it('reports the cap as a floor, not a number past what we have', () => {
    const flood = Array.from({ length: REACTION_CAP }, (_, i) =>
      event({
        id: `${i}`.padStart(64, '0'),
        kind: 7,
        pubkey: `${i}`.padStart(64, 'a'),
        content: '+',
      }));
    const got = tally(flood);
    expect(got.reactions).toBe(REACTION_CAP);
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
    expect(got.reactions).toBe(1);
  });
});
