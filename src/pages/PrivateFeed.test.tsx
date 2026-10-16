import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import PrivateFeedPage from '@/pages/PrivateFeed';
import { useKeystore } from '@/auth/useKeystore';
import { KIND_PRIVATE_REPLY, acceptConnection, closeConnection, makeRumor, noteIdOf, openConnection, openPrivateReply, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/feedEncryption';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const { scheduler } = await import('@/data/scheduler');
const { resetQueue } = await import('@/data/publish/queue');
const { store } = await import('@/data/store');


/** Click the confirm button in the open broadcast modal. */
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

describe('PrivateFeedPage', () => {
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

  it('private reactions: the count opens who reacted; reacting broadcasts a sealed 1470', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'react to my secret');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);
    // bob already reacted: a kind-7 rumor sealed into the conversation
    const bobPlus = makeRumor(getPublicKey(bob), '+', [['e', rumor.id]], 7).rumor;
    const reaction = wrapPrivateReply(bob, replyCek, bobPlus);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reaction];
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
    expect(await screen.findByText('react to my secret')).toBeTruthy();

    const user = userEvent.setup();
    // the count shows bob's reaction and opens the viewer — no broadcast
    await user.click(await screen.findByTestId('count-react'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 reaction')).toBeTruthy();
    expect(within(dialog).getByText(nip19.npubEncode(getPublicKey(bob)))).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // the heart opens the broadcast modal; confirming enqueues the sealed 1470
    await user.click(screen.getAllByRole('button', { name: 'react' })[0]);
    await confirmBroadcast(user);
    await settle();

    const published = publish.mock.calls.map(([ev]) => ev);
    const mine = published.find((ev) => ev.kind === KIND_PRIVATE_REPLY);
    expect(mine).toBeTruthy();
    // nothing readable leaks: the wrapper's content carries no target id
    // and no plaintext rumor fields
    expect(mine!.content).not.toContain(rumor.id);
    expect(mine!.content.startsWith('{"v":1,"alg":"fb-ecdh-v1"')).toBe(true);
    // and it opens back as a kind-7 rumor addressed at the note
    const opened = openPrivateReply(replyCek, mine!);
    expect(opened.kind).toBe(7);
    expect(opened.tags).toContainEqual(['e', rumor.id]);

    // clicking again opens the un-react modal; confirming deletes it
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'react' })[0]).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getAllByRole('button', { name: 'react' })[0]);
    await confirmBroadcast(user);
    await waitFor(() => expect(publish.mock.calls.some(([ev]) => ev.kind === 5)).toBe(true));
    const deletion = publish.mock.calls.find(([ev]) => ev.kind === 5)![0];
    expect(deletion.tags).toContainEqual(['e', mine!.id]);
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
    await confirmBroadcast(user);
    await settle();

    expect(await screen.findByText('edited secret')).toBeTruthy();
    expect(screen.queryByText('original secret')).toBeNull();
    const revision = published().find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    // history: an 'edited' mark opens the edit-history dialog, which shows
    // the superseded version as a diff.
    await user.click(screen.getByRole('button', { name: 'edit history' }));
    const historyDialog = await screen.findByRole('dialog');
    expect(within(historyDialog).getByText('edit history')).toBeTruthy();
    expect(within(historyDialog).getByText('original secret')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // delete: burner-signed kind 5s for every wrapper of the conversation
    await user.click(screen.getByRole('button', { name: 'delete note' }));
    await confirmBroadcast(user);
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
    await confirmBroadcast(user);
    await settle();

    expect(await screen.findByText('edited reply')).toBeTruthy();
    expect(screen.queryByText('first reply')).toBeNull();
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    // the reply's edit shows as an 'edited' mark opening its history
    await user.click(screen.getByRole('button', { name: 'edit history' }));
    const historyDialog = await screen.findByRole('dialog');
    expect(within(historyDialog).getByText('first reply')).toBeTruthy();
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
    await confirmBroadcast(user);
    // One slotless conversation event under the reply CEK: bob holds the
    // key regardless of connection state, and finds it by #n.
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    expect(revision!.tags).toContainEqual(['n', noteIdOf(replyCek)]);
  });
});
