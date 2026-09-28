import { describe, it, expect } from 'vitest';

import {
  parseFollows,
  parseRelayList,
  buildAuthorRelayMap,
  buildRelayGroups,
  mergeFeed,
} from './outbox';
import type { NostrEvent } from '@nostrify/nostrify';

const event = (kind: number, pubkey: string, content: string, tags: string[][] = [], createdAt = 1700000000): NostrEvent => ({
  id: `${pubkey.slice(0, 4)}-${kind}-${createdAt}`,
  pubkey,
  created_at: createdAt,
  kind,
  tags,
  content,
  sig: 'sig',
});

describe('parseFollows', () => {
  it('extracts and dedupes p tags from a contact list', () => {
    const list = event(3, 'user', '', [
      ['p', 'aaa'],
      ['p', 'bbb'],
      ['p', 'aaa'],
      ['e', 'not-a-follow'],
    ]);

    expect(parseFollows(list)).toEqual(['aaa', 'bbb']);
  });

  it('returns empty for a missing list', () => {
    expect(parseFollows(undefined)).toEqual([]);
  });
});

describe('parseRelayList', () => {
  it('splits r tags by marker; no marker means read+write', () => {
    const list = event(10002, 'aaa', '', [
      ['r', 'wss://both.example'],
      ['r', 'wss://read.example', 'read'],
      ['r', 'wss://write.example', 'write'],
      ['r', ''], // invalid: no url
    ]);

    expect(parseRelayList(list)).toEqual({
      read: ['wss://both.example', 'wss://read.example'],
      write: ['wss://both.example', 'wss://write.example'],
    });
  });
});

describe('buildAuthorRelayMap', () => {
  it('latest 10002 wins per author (replaceable kind)', () => {
    const older = event(10002, 'aaa', '', [['r', 'wss://old.example']], 1700000000);
    const newer = event(10002, 'aaa', '', [['r', 'wss://new.example']], 1700000600);

    const map = buildAuthorRelayMap([newer, older]);

    expect(map.get('aaa')?.write).toEqual(['wss://new.example']);
  });
});

describe('buildRelayGroups', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);

  const relays = (entries: [string, string[]][]) =>
    new Map(entries.map(([pubkey, write]) => [pubkey, { read: [], write }]));

  it('groups authors under each write relay they declared', () => {
    const groups = buildRelayGroups(
      [A, B],
      relays([
        [A, ['wss://one.example', 'wss://two.example']],
        [B, ['wss://two.example']],
      ]),
    );

    expect(groups.get('wss://one.example')).toEqual([A]);
    expect(groups.get('wss://two.example')).toEqual([A, B]);
  });

  it('skips authors with no NIP-65 list — their relays are unknown', () => {
    const groups = buildRelayGroups([A, B], relays([[A, ['wss://one.example']]]));

    expect(groups.size).toBe(1);
    expect(groups.get('wss://one.example')).toEqual([A]);
  });

  it('keeps every declared relay — an outbox declaration is authoritative', () => {
    const map = relays([
      [A, ['wss://big.example', 'wss://shared.example']],
      [B, ['wss://big.example', 'wss://shared.example']],
      [C, ['wss://tiny.example']],
    ]);

    const groups = buildRelayGroups([A, B, C], map);

    // All three relays, ranked by coverage for wave ordering.
    expect([...groups.keys()]).toEqual([
      'wss://big.example',
      'wss://shared.example',
      'wss://tiny.example',
    ]);
    expect(groups.get('wss://tiny.example')).toEqual([C]);
  });
});

describe('mergeFeed', () => {
  const note = (id: string, created_at: number) =>
    ({ id, pubkey: 'a'.repeat(64), kind: 1, created_at, tags: [], content: id, sig: 'x' }) as NostrEvent;

  it('merges wave arrival order into chronological order', () => {
    // Wave 1 lands first with older events; wave 2 arrives later with newer.
    const wave1 = [note('old1', 1000), note('old2', 900)];
    const wave2 = [note('new1', 2000), note('mid', 1500)];
    const merged = mergeFeed(wave1, wave2);
    expect(merged.map((e) => e.id)).toEqual(['new1', 'mid', 'old1', 'old2']);
  });

  it('dedupes shared ids, interleaving authors by time', () => {
    const alice = [note('a3', 3000), note('a1', 1000)];
    const bob = [note('b2', 2000), note('b0', 4000), note('a3', 3000)];
    const merged = mergeFeed(alice, bob);
    expect(merged.map((e) => e.id)).toEqual(['b0', 'a3', 'b2', 'a1']);
    expect(merged.filter((e) => e.id === 'a3')).toHaveLength(1);
  });
});
