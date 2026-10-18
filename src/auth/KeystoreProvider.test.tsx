import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { TestApp } from '@/test/TestApp';
import { useKeystore } from '@/auth/useKeystore';
import type { KeystoreContextType } from '@/auth/keystoreContext';
import { rememberBurner, resetBurners } from '@/auth/burners';
import { lock } from './keystore';

/** Captures the keystore context imperatively — login/logout are stable
 * callbacks, so the first render's handle drives the whole test. */
let ks: KeystoreContextType | undefined;
const Probe = () => {
  const keystore = useKeystore();
  useEffect(() => { ks = keystore; }, [keystore]);
  return null;
};

const mount = () =>
  render(
    <TestApp>
      <Probe />
    </TestApp>,
  );

beforeEach(() => {
  lock();
  resetBurners();
});

describe('KeystoreProvider', () => {
  it("logout flushes the logged-out identity's burners", () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    mount();
    act(() => { ks!.login(nip19.nsecEncode(sk)); });
    rememberBurner(pk, 'a'.repeat(64));
    expect(localStorage.getItem(`burners.${pk}`)).toBeTruthy();

    act(() => { ks!.logout(); });
    // the identity is captured before lock() zeroes it — the wipe must
    // still name it, or logout flushes no one
    expect(localStorage.getItem(`burners.${pk}`)).toBeNull();
  });

  it("switching identities flushes the previous identity's burners, not the new one's", () => {
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);
    mount();
    act(() => { ks!.login(nip19.nsecEncode(aliceSk)); });
    rememberBurner(alicePk, 'b'.repeat(64));

    act(() => { ks!.login(nip19.nsecEncode(bobSk)); });
    rememberBurner(bobPk, 'c'.repeat(64));

    // the wipe targets the identity being left, not the one arriving
    expect(localStorage.getItem(`burners.${alicePk}`)).toBeNull();
    expect(localStorage.getItem(`burners.${bobPk}`)).toBeTruthy();
  });
});
