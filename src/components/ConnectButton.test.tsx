import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { ConnectButton } from '@/components/ConnectButton';
import { useKeystore } from '@/auth/useKeystore';
import { useLayoutEffect, type ReactNode } from 'react';
import { acceptConnection, openConnection, requestConnection } from '@/lib/feedEncryption';
import { store } from '@/data/store';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

const confirmBroadcast = async (user: { click: (el: Element) => Promise<void> }) => {
  const dialog = await screen.findByRole('dialog');
  for (const b of await dialog.querySelectorAll('button')) {
    if ((b.textContent ?? '').trim() === 'broadcast') {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
};

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  store.clear();
});

describe('ConnectButton', () => {
  it('accepts an existing incoming request instead of minting a new one', async () => {
    const me = generateSecretKey();
    const peer = generateSecretKey();
    const user = userEvent.setup();

    // The peer already requested a connection with "me".
    const theirOffer = requestConnection(peer, getPublicKey(me));
    store.ingest([theirOffer], 'wss://peer/');

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(me)}>
          <ConnectButton pubkey={getPublicKey(peer)} />
        </Unlock>
      </TestApp>,
    );

    const button = await screen.findByRole('button', { name: /accept/i });
    await user.click(button);
    await confirmBroadcast(user);

    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(acceptConnection(me, openConnection(me, theirOffer)).kind);
    // Two signatures: the connection is now connected, not a fresh request.
    expect(openConnection(me, event).state).toBe('connected');
  });

  it('shows nothing once already connected', async () => {
    const me = generateSecretKey();
    const peer = generateSecretKey();
    const offer = requestConnection(peer, getPublicKey(me));
    const accepted = acceptConnection(me, openConnection(me, offer));
    store.ingest([accepted], 'wss://peer/');

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(me)}>
          <ConnectButton pubkey={getPublicKey(peer)} />
        </Unlock>
      </TestApp>,
    );

    expect(screen.queryByRole('button', { name: /connect|accept/i })).toBeNull();
  });
});
