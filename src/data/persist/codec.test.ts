import { afterEach, describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { getCodec, identityCodec, setCodec, type PersistedRecord } from './codec';

const record = (over: Partial<NostrEvent> = {}): PersistedRecord => ({
  event: {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    kind: 1,
    tags: [],
    content: 'hi',
    sig: 'c'.repeat(128),
    ...over,
  },
  foundOn: ['wss://a/'],
});

afterEach(() => setCodec(identityCodec));

describe('identity codec', () => {
  it('round-trips a record unchanged', async () => {
    const input = record();
    const encoded = await identityCodec.encode(input);
    expect(await identityCodec.decode(encoded)).toEqual(input);
  });

  it('is the default', () => {
    expect(getCodec()).toBe(identityCodec);
  });
});

describe('setCodec', () => {
  it('is what write and read both go through', async () => {
    const input = record();
    const wrapped = { box: input };

    setCodec({
      encode: async (r) => ({ box: r }),
      decode: async (encoded) => (encoded as typeof wrapped).box,
    });

    const encoded = await getCodec().encode(input);
    expect(encoded).toEqual(wrapped);
    expect(await getCodec().decode(encoded)).toEqual(input);
  });
});
