import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { ProfilePage } from '@/pages/Profile';
import { useKeystore } from '@/auth/useKeystore';
import { scheduler } from '@/data/scheduler';
import { resetQueue } from '@/data/publish/queue';
import {
  acceptConnection,
  makeRumor,
  openConnection,
  requestConnection,
  wrapPrivateNote,
  wrapPrivateReply,
} from '@/lib/feedEncryption';

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
  for (const b of await within(dialog).findAllByRole('button')) {
    if ((b.textContent ?? '').trim() === 'broadcast') {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
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

describe('private notes on a profile', () => {
  it('render with full engagement: counts, reactors, and sealed reactions', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(bob), 'secret from bob');
    const [note] = wrapPrivateNote(bob, [getPublicKey(alice)], rumor);
    // alice replied once, and reacted once — both sealed in the channel.
    const replyRumor = makeRumor(getPublicKey(alice), 'secret reply', [['e', rumor.id]]).rumor;
    const reply = wrapPrivateReply(alice, replyCek, replyRumor);
    const plusRumor = makeRumor(getPublicKey(alice), '+', [['e', rumor.id]], 7).rumor;
    const reaction = wrapPrivateReply(alice, replyCek, plusRumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reply, reaction];
      return [];
    });

    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <ProfilePage pubkey={getPublicKey(bob)} />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();
    await settle();

    // The note renders with its engagement row: one reply, one reaction.
    const text = await screen.findByText('secret from bob');
    const card = text.closest('[data-slot="card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    if (!card) return;
    expect(within(card).getAllByTestId('count-reply')).toHaveLength(1);
    expect(within(card).getByTestId('count-reply')).toHaveTextContent('1');
    expect(within(card).getAllByRole('button', { name: 'react' })).toHaveLength(1);

    // The reaction count opens the reactor, not a broadcast.
    await user.click(within(card).getByTestId('count-react'));
    const viewer = await screen.findByRole('dialog');
    expect(within(viewer).getByText('1 reaction')).toBeTruthy();
    expect(within(viewer).getByText(nip19.npubEncode(getPublicKey(alice)))).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Reacting from the profile broadcasts a sealed kind-7 rumor.
    // Alice already reacted, so the heart toggles: the broadcast modal
    // opens on the sealed kind-5 deletion of her reaction, not a new 1470.
    await user.click(within(card).getByRole('button', { name: 'react' }));
    await confirmBroadcast(user);
    await settle();
    const published = publish.mock.calls.map(([ev]) => ev);
    const deletion = published.find((ev) => ev.kind === 5);
    expect(deletion).toBeTruthy();
    expect(deletion!.tags).toContainEqual(['e', reaction.id]);
  });
});
