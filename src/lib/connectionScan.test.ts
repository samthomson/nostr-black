import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { requestConnection, openConnection } from '@/lib/feedEncryption';
import { scanFollowForOffer } from './connectionScan';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
});

describe('scanFollowForOffer', () => {
  it('queries the follow\'s write relays with the pairwise address and opens their request', async () => {
    const me = generateSecretKey();
    const peer = generateSecretKey();
    const offer = requestConnection(peer, getPublicKey(me));
    queryRelay.mockResolvedValue([offer]);

    const record = await scanFollowForOffer(me, getPublicKey(peer), ['wss://theirs/']);

    expect(record?.state).toBe('request');
    expect(record?.peer).toBe(getPublicKey(peer));
    // the query went to their relay with our d tag, not a firehose
    expect(queryRelay).toHaveBeenCalledWith(
      'wss://theirs/',
      [expect.objectContaining({ kinds: [30378] })],
      expect.anything(),
    );
    expect(queryRelay.mock.calls[0][1][0]['#d']).toEqual([
      expect.any(String),
    ]);
  });

  it('returns undefined when the relay answers nothing', async () => {
    const me = generateSecretKey();
    const record = await scanFollowForOffer(me, getPublicKey(generateSecretKey()), ['wss://x/']);
    expect(record).toBeUndefined();
  });

  it('returns undefined for a follow with no known relays — no query at all', async () => {
    const me = generateSecretKey();
    const record = await scanFollowForOffer(me, getPublicKey(generateSecretKey()), []);
    expect(record).toBeUndefined();
    expect(queryRelay).not.toHaveBeenCalled();
  });

  it('skips records that are not a plain request from that peer', async () => {
    const me = generateSecretKey();
    const other = generateSecretKey();
    // an offer addressed to someone else — undecryptable for me
    const wrongOffer = requestConnection(other, getPublicKey(generateSecretKey()));
    queryRelay.mockResolvedValue([wrongOffer]);

    const record = await scanFollowForOffer(me, getPublicKey(other), ['wss://x/']);
    expect(record).toBeUndefined();
  });

  it('prefers the first relay that holds a valid offer', async () => {
    const me = generateSecretKey();
    const peer = generateSecretKey();
    const offer = requestConnection(peer, getPublicKey(me));
    queryRelay.mockImplementation(async (url) => (url === 'wss://second/' ? [offer] : []));

    const record = await scanFollowForOffer(me, getPublicKey(peer), ['wss://first/', 'wss://second/']);
    expect(record?.peer).toBe(getPublicKey(peer));
    expect(queryRelay).toHaveBeenCalledTimes(2);
  });
});
