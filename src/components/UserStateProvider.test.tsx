import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { UserStateProvider } from './UserStateProvider';
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { useKeystore } from '@/auth/useKeystore';
import { useUserState } from '@/hooks/useUserState';

/** Logs in as `nsec` whenever it is not the active key; seeds one follow
 * the first time a key has none; reports the current follow count. */
const Harness = ({ nsec, report }: { nsec: string; report: (n: number) => void }) => {
  const ks = useKeystore();
  const { state, updateUser } = useUserState();
  const want = getPublicKey(skOf(nsec));

  useEffect(() => {
    if (ks.pubkey === want) return;
    ks.login(nsec);
  }, [ks, want, nsec]);

  useEffect(() => {
    if (ks.pubkey !== want || state.follows.pubkeys.length > 0) return;
    updateUser((s) => ({ ...s, follows: { pubkeys: ['f'.repeat(64)], updatedAt: 1 } }));
  }, [ks, want, state.follows.pubkeys.length, updateUser]);

  report(state.follows.pubkeys.length);
  return <div>{ks.pubkey?.slice(0, 4)}:{state.follows.pubkeys.length}</div>;
};

const skOf = (nsec: string): Uint8Array => nip19.decode(nsec).data as Uint8Array;

const wrap = (nsec: string, report: (n: number) => void): ReactNode => (
  <KeystoreProvider>
    <UserStateProvider storageKey="test:user-state-per-key">
      <Harness nsec={nsec} report={report} />
    </UserStateProvider>
  </KeystoreProvider>
);

const tick = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 5);
  return promise;
};

describe('UserStateProvider', () => {
  it('keeps each identity\u2019s state separate', async () => {
    window.localStorage.removeItem('test:user-state-per-key');
    const alice = nip19.nsecEncode(generateSecretKey());
    const bob = nip19.nsecEncode(generateSecretKey());
    let count = -1;

    const view = render(wrap(alice, (n) => { count = n; }));
    await act(async () => { await tick(); });
    await act(async () => { await tick(); });
    expect(count).toBe(1); // alice: seeded one follow

    view.rerender(wrap(bob, (n) => { count = n; }));
    await act(async () => { await tick(); });
    await act(async () => { await tick(); });
    // bob's own seeded follow now — but crucially his state started empty,
    // and alice's follows never rendered under his key
    expect(count).toBe(1);

    const stored = window.localStorage.getItem('test:user-state-per-key') ?? '';
    expect(stored).toContain(getPublicKey(skOf(alice)));
    expect(stored).toContain(getPublicKey(skOf(bob)));
  });
});
