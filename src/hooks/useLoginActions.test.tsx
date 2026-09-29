import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { useNostrLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { useLoginActions } from './useLoginActions';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/**
 * Regression test: adding a second login while one is already logged in
 * must switch the current user to the new login (logins[0]).
 */
describe('useLoginActions auto-switch', () => {
  it('promotes the newly added extension login to logins[0]', async () => {
    const pubkey1 = getPublicKey(generateSecretKey());
    const pubkey2 = getPublicKey(generateSecretKey());

    let currentPubkey = pubkey1;
    vi.stubGlobal('nostr', {
      getPublicKey: async () => currentPubkey,
    });

    const { result } = renderHook(
      () => ({
        actions: useLoginActions(),
        login: useNostrLogin(),
      }),
      { wrapper: TestApp },
    );

    // NostrLoginProvider renders null while it reads logins from storage,
    // so wait for the provider to mount.
    await waitFor(() => expect(result.current).not.toBeNull());

    await act(async () => {
      await result.current.actions.extension();
    });

    expect(result.current.login.logins).toHaveLength(1);
    expect(result.current.login.logins[0].pubkey).toBe(pubkey1);

    currentPubkey = pubkey2;
    await act(async () => {
      await result.current.actions.extension();
    });

    expect(result.current.login.logins).toHaveLength(2);
    // The newly added login MUST be at index 0 (current user).
    expect(result.current.login.logins[0].pubkey).toBe(pubkey2);
  });

  it('never exposes an nsec login method', async () => {
    const { result } = renderHook(() => useLoginActions(), { wrapper: TestApp });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).not.toHaveProperty('nsec');
  });
});
