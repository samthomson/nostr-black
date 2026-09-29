import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { createStore } from './store';
import { childrenOf, isDirectChild } from './thread';

const PARENT = 'p'.repeat(64);
const OTHER = 'o'.repeat(64);
const ALICE = 'a'.repeat(64);

const event = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: over.id ?? '1'.repeat(64),
  pubkey: ALICE,
  created_at: over.created_at ?? 1000,
  kind: over.kind ?? 1,
  tags: over.tags ?? [],
  content: '',
  sig: 'c'.repeat(128),
  ...over,
});

describe('isDirectChild', () => {
  it('accepts a NIP-10 reply to this parent', () => {
    const reply = event({
      tags: [
        ['e', PARENT, '', 'root'],
        ['e', PARENT, '', 'reply'],
      ],
    });
    expect(isDirectChild(reply, PARENT)).toBe(true);
  });

  it('accepts a NIP-22 comment whose lowercase e is this parent', () => {
    const comment = event({
      kind: 1111,
      tags: [
        ['E', PARENT],
        ['e', PARENT],
      ],
    });
    expect(isDirectChild(comment, PARENT)).toBe(true);
  });

  it('rejects a NIP-22 comment that only names this id as the root', () => {
    const deep = event({
      kind: 1111,
      tags: [
        ['E', PARENT],
        ['e', OTHER],
      ],
    });
    expect(isDirectChild(deep, PARENT)).toBe(false);
  });

  it('rejects a NIP-10 reply whose parent is a different note', () => {
    const nested = event({
      tags: [
        ['e', PARENT, '', 'root'],
        ['e', OTHER, '', 'reply'],
      ],
    });
    expect(isDirectChild(nested, PARENT)).toBe(false);
    expect(isDirectChild(nested, OTHER)).toBe(true);
  });
});

describe('childrenOf', () => {
  it('returns only direct children, oldest first', () => {
    const store = createStore();
    store.ingest([
      event({ id: '2'.repeat(64), created_at: 200, tags: [['e', PARENT, '', 'reply']] }),
      event({ id: '3'.repeat(64), created_at: 100, kind: 1111, tags: [['E', PARENT], ['e', PARENT]] }),
      event({ id: '4'.repeat(64), created_at: 150, kind: 1111, tags: [['E', PARENT], ['e', OTHER]] }),
      event({ id: '5'.repeat(64), created_at: 50, kind: 7, tags: [['e', PARENT]] }),
    ], 'wss://a/');

    expect(childrenOf(store, PARENT).map((e) => e.created_at)).toEqual([100, 200]);
  });
});
