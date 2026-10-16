import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { PrivateThreadPage } from '@/pages/PrivateThread';
import { useKeystore } from '@/auth/useKeystore';
import { KIND_PRIVATE_REPLY, acceptConnection, makeRumor, openConnection, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/feedEncryption';

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

const renderThread = (nsec: string, id: string) => {
  window.history.pushState({}, '', `/private-feed/${nip19.neventEncode({ id, author: undefined, relays: [] })}`);
  return render(
    <TestApp>
      <Unlock nsec={nsec}>
        <Routes>
          <Route path="/private-feed/:nip19" element={<PrivateThreadPage />} />
        </Routes>
      </Unlock>
    </TestApp>,
  );
};
beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('PrivateThreadPage', () => {
  it('shows the note opened: replies and composer under it, edit on your own reply', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'root secret');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);
    const replyRumor = makeRumor(getPublicKey(bob), 'first reply', [['e', rumor.id]]).rumor;
    const reply = wrapPrivateReply(bob, replyCek, replyRumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reply];
      return [];
    });

    renderThread(nip19.nsecEncode(bob), rumor.id);
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText('root secret')).toBeTruthy();
    expect(screen.getByText('first reply')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'reply…' })).toBeTruthy();
    // The note is alice's — no edit for bob. His own reply is editable.
    expect(screen.getAllByRole('button', { name: 'edit note' })).toHaveLength(1);
  });

  it('replying from the thread broadcasts a sealed reply to the conversation', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor } = makeRumor(getPublicKey(alice), 'root secret');
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], rumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      return [];
    });

    renderThread(nip19.nsecEncode(bob), rumor.id);
    await settle();
    await settle();
    await settle();

    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: 'reply…' });
    await user.type(box, 'sealed answer');
    await user.click(screen.getByRole('button', { name: 'reply' }));
    await confirmBroadcast(user);
    await settle();

    const published = publish.mock.calls.map(([ev]) => ev);
    const sent = published.find((ev) => ev.kind === KIND_PRIVATE_REPLY);
    expect(sent).toBeTruthy();
    expect(sent!.content).not.toContain('sealed answer');
  });

  it('an unknown note id is not found', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      return [];
    });

    renderThread(nip19.nsecEncode(bob), '0'.repeat(64));
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText(/couldn't find that note in your conversations/)).toBeTruthy();
  });

  it('lets a reply author edit their reply from the thread page', async () => {
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

    renderThread(nip19.nsecEncode(bob), rumor.id);
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText('first reply')).toBeTruthy();
    const user = userEvent.setup();

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
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    // the reply's edit shows as an 'edited' mark opening its history
    await user.click(screen.getByRole('button', { name: 'edit history' }));
    const historyDialog = await screen.findByRole('dialog');
    expect(within(historyDialog).getByText('first reply')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
