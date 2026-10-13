import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import PrivateFeedPage from '@/pages/PrivateFeed';
import { useKeystore } from '@/auth/useKeystore';
import { acceptConnection, makeRumor, openConnection, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/fe';

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

describe('PrivateFeedPage', () => {
  it('asks for a session key when logged out', async () => {
    render(
      <TestApp>
        <PrivateFeedPage />
      </TestApp>,
    );
    expect(await screen.findByText('log in to use the private feed')).toBeTruthy();
  });

  it('points at connections when the session has none', async () => {
    const alice = generateSecretKey();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <PrivateFeedPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();
    expect(screen.getByText(/no connections yet/)).toBeTruthy();
  });

  it('renders notes and replies through the standard Note chrome, info button included', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'secret from alice');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);
    const { rumor: replyRumor } = makeRumor(getPublicKey(bob), 'secret reply from bob', [['e', rumor.id]]);
    const reply = wrapPrivateReply(bob, replyCek, replyRumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0].kinds?.includes(1370)) return [note];
      if (filters[0].kinds?.includes(1470)) return [reply];
      return [];
    });

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(bob)}>
          <PrivateFeedPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText('secret from alice')).toBeTruthy();
    expect(await screen.findByText('secret reply from bob')).toBeTruthy();
    // Post and reply both render as standard feed items: one info button each.
    // Recipient view: no edit affordance on someone else's note, and the
    // only delete button is bob's own reply.
    expect(screen.queryByRole('button', { name: 'edit note' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'delete note' })).toHaveLength(1);

    // The info dialog shows the wrapper — the event relays hold — not the rumor.
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'event info' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('event info')).toBeTruthy();
    expect(within(dialog).getByText('1370')).toBeTruthy();
    expect(within(dialog).queryByText(/secret from alice/)).toBeNull();
  });

  it('lets the author edit and delete their own note', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor } = makeRumor(getPublicKey(alice), 'original secret');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0].kinds?.includes(1370)) return [note];
      return [];
    });

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <PrivateFeedPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText('original secret')).toBeTruthy();
    const user = userEvent.setup();
    const published = () => publish.mock.calls.map(([ev]) => ev);

    // edit: publish a revision, the original disappears from the feed
    await user.click(screen.getByRole('button', { name: 'edit note' }));
    const box = screen.getByRole('textbox', { name: 'edit note' });
    await user.clear(box);
    await user.type(box, 'edited secret');
    await user.click(screen.getByRole('button', { name: 'save' }));
    await settle();

    expect(await screen.findByText('edited secret')).toBeTruthy();
    expect(screen.queryByText('original secret')).toBeNull();
    const revision = published().find((ev) => ev.kind === 1370);
    expect(revision).toBeTruthy();
    // delete: burner-signed kind 5s for every wrapper of the conversation
    await user.click(screen.getByRole('button', { name: 'delete note' }));
    await settle();

    const deletions = published().filter((ev) => ev.kind === 5);
    expect(deletions).toHaveLength(2);
    expect(deletions.map((d) => d.tags[0]?.[1]))
      .toEqual(expect.arrayContaining([note.id, revision?.id]));
    expect(await screen.findByText(/no private notes yet/)).toBeTruthy();
  });
});
