import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { extractWants } from './extract';
import { wantKey } from './scheduler';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const NOTE = '1'.repeat(64);
const ROOT = '2'.repeat(64);

const event = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: '9'.repeat(64),
  pubkey: ALICE,
  created_at: 1000,
  kind: 1,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
  ...over,
});

const types = (wants: ReturnType<typeof extractWants>) =>
  wants.map((w) => wantKey(w));

describe('extractWants', () => {
  it('always asks for the author\'s profile', () => {
    expect(extractWants(event())).toEqual([{ type: 'profile', pubkey: ALICE }]);
  });

  it('pulls a NIP-10 reply and its author', () => {
    const wants = extractWants(event({
      tags: [
        ['e', ROOT, 'wss://hint/', 'root'],
        ['e', NOTE, 'wss://hint/', 'reply'],
        ['p', BOB],
      ],
    }));

    expect(types(wants)).toContain(`event:${NOTE}`);
    expect(types(wants)).toContain(`profile:${BOB}`);
    const parent = wants.find((w) => w.type === 'event');
    expect(parent && parent.type === 'event' && parent.hints).toEqual(['wss://hint/']);
  });

  it('pulls a root-only reply when there is no reply marker', () => {
    const wants = extractWants(event({
      tags: [['e', ROOT, '', 'root']],
    }));
    expect(types(wants)).toContain(`event:${ROOT}`);
  });

  it('pulls a quote tag', () => {
    const wants = extractWants(event({
      tags: [['q', NOTE, 'wss://q/', BOB]],
    }));
    expect(types(wants)).toContain(`event:${NOTE}`);
    expect(types(wants)).toContain(`profile:${BOB}`);
  });

  it('pulls the embedded event of a repost', () => {
    const inner = event({ id: NOTE, pubkey: BOB, content: 'hi' });
    const wants = extractWants(event({
      kind: 6,
      content: JSON.stringify(inner),
      tags: [['e', NOTE, '', BOB]],
    }));
    expect(types(wants)).toContain(`event:${NOTE}`);
    expect(types(wants)).toContain(`profile:${BOB}`);
  });

  it('pulls npub and note mentions from content', () => {
    const npub = nip19.npubEncode(BOB);
    const note = nip19.noteEncode(NOTE);
    const wants = extractWants(event({
      content: `hey nostr:${npub} see nostr:${note}`,
    }));
    expect(types(wants)).toContain(`profile:${BOB}`);
    expect(types(wants)).toContain(`event:${NOTE}`);
  });

  it('pulls an naddr mention as an addressable plus its author', () => {
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: BOB,
      identifier: 'post',
    });
    const wants = extractWants(event({ content: `nostr:${naddr}` }));
    expect(types(wants)).toContain(`a:30023:${BOB}:post`);
    expect(types(wants)).toContain(`profile:${BOB}`);
  });

  it('skips malformed tags and bech32 instead of throwing', () => {
    const wants = extractWants(event({
      tags: [['e', 'not-an-id'], ['q', ''], ['p', 'short']],
      content: 'nostr:note1zzzz',
    }));
    expect(wants).toEqual([{ type: 'profile', pubkey: ALICE }]);
  });

  it('dedupes the same want implied twice', () => {
    const wants = extractWants(event({
      tags: [['p', ALICE], ['e', NOTE]],
      content: `nostr:${nip19.noteEncode(NOTE)}`,
    }));
    const keys = types(wants);
    expect(keys).toEqual([...new Set(keys)]);
  });
});
