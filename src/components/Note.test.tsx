import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { queuedEntries, resetQueue } from '@/data/publish/queue';
import { store } from '@/data/store';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { Note } from '@/components/Note';
import { useKeystore } from '@/auth/useKeystore';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));


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

const note = (sk: Uint8Array, content: string): NostrEvent =>
  finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  }, sk);

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('Note', () => {
  it('deletes a public note you authored with a kind 5 from your signer', async () => {
    const alice = generateSecretKey();
    const event = note(alice, 'my public note');
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <Note event={event} />
        </Unlock>
      </TestApp>,
    );

    await user.click(await screen.findByRole('button', { name: 'delete note' }));
    await confirmBroadcast(user);

    expect(publish).toHaveBeenCalled();
    const [deletion] = publish.mock.calls[0];
    expect(deletion.kind).toBe(5);
    expect(deletion.pubkey).toBe(event.pubkey);
    expect(deletion.tags).toContainEqual(['e', event.id]);
    expect(verifyEvent(deletion)).toBe(true);
  });

  it('surfaces a failed deletion instead of failing silently', async () => {
    const alice = generateSecretKey();
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <Note event={note(alice, 'doomed')} />
        </Unlock>
      </TestApp>,
    );

    publish.mockRejectedValueOnce(new Error('relay down'));
    await user.click(await screen.findByRole('button', { name: 'delete note' }));
    await confirmBroadcast(user);

    // the queue keeps the failed broadcast with its error
    await waitFor(() => {
      const failed = queuedEntries().filter((e) => e.status === 'failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]!.error).toBe('relay down');
    });
  });

  it('the count opens who reacted — it never reacts on click', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const target = note(alice, 'react to me');
    const user = userEvent.setup();
    // bob's reaction, indexed by the store's ref index
    store.ingest([finalizeEvent({
      kind: 7, created_at: target.created_at + 5, content: '+',
      tags: [['e', target.id], ['p', target.pubkey]],
    }, bob)], '');

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <Note event={target} />
        </Unlock>
      </TestApp>,
    );

    // clicking the count shows the reactor, and enqueues nothing
    await user.click(await screen.findByTestId('count-react'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(nip19.npubEncode(getPublicKey(bob)))).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
    expect(queuedEntries()).toHaveLength(0);
  });

  it('the heart opens the broadcast modal; confirming enqueues the kind 7', async () => {
    const alice = generateSecretKey();
    const target = note(alice, 'react target');
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <Note event={target} />
        </Unlock>
      </TestApp>,
    );

    await user.click(await screen.findByRole('button', { name: 'react' }));
    await confirmBroadcast(user);

    expect(publish).toHaveBeenCalledTimes(1);
    const [reaction] = publish.mock.calls[0];
    expect(reaction.kind).toBe(7);
    expect(reaction.content).toBe('+');
    expect(reaction.tags).toContainEqual(['e', target.id]);
    expect(verifyEvent(reaction)).toBe(true);
  });

  it('clicking the heart again un-reacts — a kind 5 of your own reaction', async () => {
    const alice = generateSecretKey();
    const target = note(alice, 'toggle me');
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <Note event={target} />
        </Unlock>
      </TestApp>,
    );

    await user.click(await screen.findByRole('button', { name: 'react' }));
    await confirmBroadcast(user);
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    // the queue ingested it, so the heart now reads as mine
    await waitFor(() => expect(screen.getByRole('button', { name: 'react' })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getByRole('button', { name: 'react' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    const [deletion] = publish.mock.calls[1];
    expect(deletion.kind).toBe(5);
    expect(deletion.tags).toContainEqual(['e', publish.mock.calls[0][0].id]);
    expect(deletion.pubkey).toBe(getPublicKey(alice));
  });

  it('offers no actions on someone else\'s note', async () => {
    render(
      <TestApp>
        <Note event={note(generateSecretKey(), 'their note')} />
      </TestApp>,
    );

    expect(await screen.findByText('their note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'delete note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'edit note' })).toBeNull();
  });
});
