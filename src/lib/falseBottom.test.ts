import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  aliasOf,
  connAddrOf,
  connKeyOf,
  derivedIdentityIdOf,
  openAuthorKey,
  sealAuthorKey,
  openEnvelope,
  parseEnvelope,
  sealEnvelope,
  sealSlotless,
  openSlotless,
  encodeEnvelope,
} from './falseBottom';

const pair = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

describe('NIP-FB envelope', () => {
  it('opens for every recipient and nobody else', () => {
    const author = pair();
    const alice = pair();
    const bob = pair();
    const eve = pair();
    const payload = new TextEncoder().encode('secret note');

    const { envelope } = sealEnvelope(author.sk, [alice.pk, bob.pk], payload);
    expect(envelope.slots.length).toBeGreaterThan(2);

    const openedA = openEnvelope(alice.sk, author.pk, envelope);
    const openedB = openEnvelope(bob.sk, author.pk, envelope);
    expect(new TextDecoder().decode(openedA)).toBe('secret note');
    expect(new TextDecoder().decode(openedB)).toBe('secret note');
    expect(() => openEnvelope(eve.sk, author.pk, envelope)).toThrow('not a recipient');
  });

  it('round-trips through event content json', () => {
    const author = pair();
    const alice = pair();
    const { envelope } = sealEnvelope(author.sk, [alice.pk], new TextEncoder().encode('x'));
    const again = parseEnvelope(encodeEnvelope(envelope));
    expect(new TextDecoder().decode(openEnvelope(alice.sk, author.pk, again))).toBe('x');
  });

  it('rejects an empty recipient list', () => {
    const author = pair();
    expect(() => sealEnvelope(author.sk, [], new Uint8Array([1]))).toThrow('recipients');
  });

  it('opens a slotless envelope only with the known cek', () => {
    const cek = new Uint8Array(32).fill(7);
    const env = sealSlotless(cek, new TextEncoder().encode('reply'));
    expect(env.slots).toEqual([]);
    expect(new TextDecoder().decode(openSlotless(cek, env))).toBe('reply');
    expect(() => openEnvelope(pair().sk, pair().pk, env)).toThrow('slotless');
  });
});

describe('NIP-FB aliases', () => {
  it('is symmetric for a pair', () => {
    const a = pair();
    const b = pair();
    expect(aliasOf(a.sk, b.pk)).toBe(aliasOf(b.sk, a.pk));
    expect(connAddrOf(a.sk, b.pk)).toBe(connAddrOf(b.sk, a.pk));
    expect(connKeyOf(a.sk, b.pk)).toEqual(connKeyOf(b.sk, a.pk));
  });

  it('differs across pairs and domain labels', () => {
    const a = pair();
    const b = pair();
    const c = pair();
    expect(aliasOf(a.sk, b.pk)).not.toBe(aliasOf(a.sk, c.pk));
    expect(aliasOf(a.sk, b.pk)).not.toBe(connAddrOf(a.sk, b.pk));
    expect(derivedIdentityIdOf(a.sk)).not.toBe(derivedIdentityIdOf(b.sk));
  });
});

describe('author key tag', () => {
  it('seals with the envelope key and only the author opens', () => {
    const envelope = pair();
    const author = pair();
    const eve = pair();
    const sealed = sealAuthorKey(envelope.sk, author.pk);

    const reopened = openAuthorKey(author.sk, envelope.pk, sealed);
    expect(getPublicKey(reopened)).toBe(envelope.pk);
    expect(() => openAuthorKey(eve.sk, envelope.pk, sealed)).toThrow();
  });
});
