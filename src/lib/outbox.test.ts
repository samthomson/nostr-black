import { describe, it, expect } from 'vitest';

import {
  parseFollows,
  parseRelayList,
  buildAuthorRelayMap,
  buildRelayGroups,
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
