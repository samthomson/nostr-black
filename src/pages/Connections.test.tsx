import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
const { resetQueue } = await import('@/data/publish/queue');


/** Click the confirm button in the open broadcast modal. */
const confirmBroadcast = async (user: { click: (el: Element) => Promise<void> }) => {
  const dialog = await screen.findByRole('dialog');
  const buttons = await within(dialog).findAllByRole('button');
  for (const b of buttons) {
    const text = b.textContent ?? '';
    if (text.trim() === 'broadcast') {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
};

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
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('ConnectionsPage', () => {
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
    await user.click(screen.getByRole('button', { name: 'send request' }));
    await confirmBroadcast(user);

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
    await user.click(screen.getByRole('button', { name: 'someone said they invited you? paste their npub above and check' }));
    await settle();

    await user.click(await screen.findByRole('button', { name: 'accept' }));
    await confirmBroadcast(user);
    expect(publish).toHaveBeenCalled();
    const accepted = publish.mock.calls[0][0];
    expect(openConnection(alice, accepted).state).toBe('connected');
    expect(accepted.kind).toBe(acceptConnection(bob, openConnection(bob, offer)).kind);
  });

  it('after sending a request, the card hands over the invite link to send', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    queryRelay.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <ConnectionsPage />
        </Unlock>
      </TestApp>,
    );

    await user.type(await screen.findByLabelText('npub'), nip19.npubEncode(getPublicKey(bob)));
    await user.click(screen.getByRole('button', { name: 'send request' }));
    await confirmBroadcast(user);

    // The card became the hand-off: their link, front and center.
    expect(await screen.findByText(/request sent to/)).toBeTruthy();
    expect(screen.getByText(/send them this link/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'copy link' }));
    expect(writeText).toHaveBeenCalledWith(
      `http://localhost:3000/connections?peer=${nip19.npubEncode(getPublicKey(alice))}`,
    );
    expect(await screen.findByRole('button', { name: 'copied' })).toBeTruthy();

    // Done closes the hand-off; the request waits in the list below.
    await user.click(screen.getByRole('button', { name: 'done' }));
    expect(screen.queryByText(/request sent to/)).toBeNull();
  });

  it('an invite link (?peer=) auto-looks-up the requester — accept with no typing', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378) && filters[0]['#d']?.length) return [offer];
      return [];
    });

    // The link the requester would have sent: /connections?peer=<their npub>
    window.history.replaceState({}, '', `/connections?peer=${nip19.npubEncode(getPublicKey(alice))}`);
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(bob)}>
          <ConnectionsPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();

    // Their request is here, in incoming, without bob touching the form.
    await user.click(await screen.findByRole('button', { name: 'accept' }));
    await confirmBroadcast(user);
    expect(publish).toHaveBeenCalled();
    expect(openConnection(alice, publish.mock.calls[0][0]).state).toBe('connected');
    // The served purpose: the param is cleared on accept.
    expect(window.location.search).toBe('');
  });
});
