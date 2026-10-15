import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import ConnectionsPage from '@/pages/Connections';
import { useKeystore } from '@/auth/useKeystore';
import { useLayoutEffect, type ReactNode } from 'react';
import { acceptConnection, openConnection, requestConnection } from '@/lib/feedEncryption';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const { scheduler } = await import('@/data/scheduler');

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

const settle = async () => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await scheduler.flush(); });
};

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('ConnectionsPage', () => {
  it('asks to log in when there is no session', async () => {
    render(
      <TestApp>
        <ConnectionsPage />
      </TestApp>,
    );
    expect(await screen.findByText('log in to use connections')).toBeTruthy();
  });

  it('publishes a kind 30378 request to the peer', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <ConnectionsPage />
        </Unlock>
      </TestApp>,
    );

    await user.type(await screen.findByLabelText('npub'), nip19.npubEncode(getPublicKey(bob)));
    await user.click(screen.getByRole('button', { name: 'request' }));

    expect(publish).toHaveBeenCalled();
    const event = publish.mock.calls[0][0];
    expect(event.kind).toBe(30378);
    expect(openConnection(bob, event).state).toBe('request');
  });

  it('accepts an incoming offer after look up', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378) && filters[0]['#d']?.length) return [offer];
      return [];
    });
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(bob)}>
          <ConnectionsPage />
        </Unlock>
      </TestApp>,
    );

    await user.type(await screen.findByLabelText('npub'), nip19.npubEncode(getPublicKey(alice)));
    await user.click(screen.getByRole('button', { name: 'look up' }));
    await settle();

    await user.click(await screen.findByRole('button', { name: 'accept' }));
    expect(publish).toHaveBeenCalled();
    const accepted = publish.mock.calls[0][0];
    expect(openConnection(alice, accepted).state).toBe('connected');
    expect(accepted.kind).toBe(acceptConnection(bob, openConnection(bob, offer)).kind);
  });
});
