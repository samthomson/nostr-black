import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  parseFollows,
  parseRelayList,
  buildAuthorRelayMap,
  buildRelayGroups,
  moveFollow,
  moveMute,
  sealPrivateList,
  openPrivateList,
  parseMutes,
  parsePrivateFollows,
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

describe('private follow/mute lists (NIP-51 encrypted content)', () => {
  const sk = generateSecretKey();
  const alice = getPublicKey(generateSecretKey());
  const bob = getPublicKey(generateSecretKey());

  const listEvent = (kind: number, tags: string[][], content: string): NostrEvent =>
    finalizeEvent({ kind, created_at: 100, tags, content }, sk) as NostrEvent;

  it('seals and opens private p entries', () => {
    const content = sealPrivateList(sk, [['p', alice]]);
    const opened = openPrivateList(sk, listEvent(3, [], content));
    expect(opened).toEqual([['p', alice]]);
  });

  it('decodes legacy nip04 ciphertext from older clients', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('nostr-tools');
    const legacy = t.nip04.encrypt(sk, getPublicKey(sk), JSON.stringify([['p', bob]]));
    const opened = openPrivateList(sk, listEvent(3, [], legacy));
    expect(opened).toEqual([['p', bob]]);
  });

  it('fails visibly on junk content — never a silent empty list', () => {
    expect(() => openPrivateList(sk, listEvent(3, [], 'not ciphertext'))).toThrow();
  });

  it('moves a public follow to private — still followed, other half survives', () => {
    const old = listEvent(3, [['p', alice], ['p', bob]], '');
    const next = moveFollow(sk, old, alice, 'private');
    expect(parseFollows({ ...old, tags: next.tags })).toEqual([bob]);
    expect(parsePrivateFollows(sk, { ...old, tags: next.tags, content: next.content })).toEqual([alice]);
  });

  it('unfollow removes from whichever list held the person', () => {
    const sealed = moveFollow(sk, listEvent(3, [['p', alice]], ''), bob, 'private');
    const event = listEvent(3, sealed.tags, sealed.content);
    const next = moveFollow(sk, event, bob, false);
    expect(parsePrivateFollows(sk, { ...event, tags: next.tags, content: next.content })).toEqual([]);
    const next2 = moveFollow(sk, event, alice, false);
    expect(parseFollows({ ...event, tags: next2.tags })).toEqual([]);
  });

  it('mute: moves a public mute to private (kind 10000)', () => {
    const old = listEvent(10000, [['p', alice]], '');
    const next = moveMute(sk, old, alice, 'private');
    const mutes = parseMutes(sk, { ...old, tags: next.tags, content: next.content });
    expect(mutes.public).toEqual([]);
    expect(mutes.private).toEqual([alice]);
  });
});


