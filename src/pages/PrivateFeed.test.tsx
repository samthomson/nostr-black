import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import PrivateFeedPage from '@/pages/PrivateFeed';
import { useKeystore } from '@/auth/useKeystore';
import { acceptConnection, closeConnection, makeRumor, noteIdOf, openConnection, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/feedEncryption';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

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
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reply];
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
    // Recipient view: no edit affordance on someone else's note — the only
    // edit button is bob's, on his own reply. Same for delete.
    expect(screen.getAllByRole('button', { name: 'edit note' })).toHaveLength(1);
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
      if (filters[0]['#f']) return [note];
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
    const revision = published().find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    // history: the superseded versions hide behind an 'edited' toggle
    await user.click(screen.getByRole('button', { name: /edited — 2 versions/ }));
    expect(await screen.findByText(/original secret/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /edited — 2 versions/ }));
    expect(screen.queryByText(/original secret/)).toBeNull();
    // delete: burner-signed kind 5s for every wrapper of the conversation
    await user.click(screen.getByRole('button', { name: 'delete note' }));
    await settle();

    // Both the chunk and our revision event are deleted — each via its own burner.
    const deletions = published().filter((ev) => ev.kind === 5);
    expect(deletions).toHaveLength(2);
    expect(deletions.map((d) => d.tags[0]?.[1]))
      .toEqual(expect.arrayContaining([note.id, revision!.id]));
    expect(await screen.findByText(/no private notes yet/)).toBeTruthy();
  });

  it('lets a reply author edit their reply', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'root note');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);
    const replyRumor = makeRumor(getPublicKey(bob), 'first reply', [['e', rumor.id]]).rumor;
    const reply = wrapPrivateReply(bob, replyCek, replyRumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reply];
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

    expect(await screen.findByText('first reply')).toBeTruthy();
    const user = userEvent.setup();

    // The note is alice's — no edit for bob. His own reply is editable.
    const editButtons = screen.getAllByRole('button', { name: 'edit note' });
    expect(editButtons).toHaveLength(1);

    await user.click(editButtons[0]);
    const box = screen.getByRole('textbox', { name: 'edit note' });
    await user.clear(box);
    await user.type(box, 'edited reply');
    await user.click(screen.getByRole('button', { name: 'save' }));
    await settle();

    expect(await screen.findByText('edited reply')).toBeTruthy();
    expect(screen.queryByText('first reply')).toBeNull();
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
  });

  it('a revision still reaches a peer whose connection has since closed', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const closed = closeConnection(alice, openConnection(alice, accepted));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'note while connected');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);

    let connectionState = accepted;
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [connectionState];
      if (filters[0]['#f']) return [note];
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
    expect(await screen.findByText('note while connected')).toBeTruthy();

    // The connection closes after the note was read.
    connectionState = closed;
    act(() => { store.ingest([closed], 'wss://r/'); });
    await settle();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'edit note' }));
    const box = screen.getByRole('textbox', { name: 'edit note' });
    await user.clear(box);
    await user.type(box, 'edited after close');
    await user.click(screen.getByRole('button', { name: 'save' }));
    // One slotless conversation event under the reply CEK: bob holds the
    // key regardless of connection state, and finds it by #n.
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    expect(revision!.tags).toContainEqual(['n', noteIdOf(replyCek)]);
  });
});
