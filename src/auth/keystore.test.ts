import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  currentPubkey,
  flushSession,
  isUnlocked,
  lock,
  storedSession,
  unlock,
} from './keystore';

describe('keystore', () => {
  it('unlocks, reports the pubkey, and locks', () => {
    const sk = generateSecretKey();
    expect(unlock(nip19.nsecEncode(sk))).toBe(getPublicKey(sk));
    expect(isUnlocked()).toBe(true);
    expect(currentPubkey()).toBe(getPublicKey(sk));

    lock();
    expect(isUnlocked()).toBe(false);
    expect(currentPubkey()).toBeNull();
  });

  it('remembers the nsec across unlock, and logout flushes it', () => {
    const sk = generateSecretKey();
    unlock(nip19.nsecEncode(sk));
    expect(storedSession()).toBe(nip19.nsecEncode(sk));

    lock();
    // Locking keeps the remembered key — only logout forgets the device.
    expect(storedSession()).toBe(nip19.nsecEncode(sk));

    flushSession();
    expect(storedSession()).toBeNull();
  });

  it('throws on garbage', () => {
    expect(() => unlock('npub1garbage')).toThrow();
    expect(isUnlocked()).toBe(false);
  });
});
