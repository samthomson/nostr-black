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
  it('a repost is never worded as a reply', async () => {
    const alice = generateSecretKey();
    const target = note(alice, 'the reposted words');
    const repost = finalizeEvent({
      kind: 6,
      created_at: target.created_at + 5,
      content: '',
      tags: [['e', target.id], ['p', target.pubkey]],
    }, generateSecretKey());
    // the repost target lives on the store, so the reposted note renders inline
    store.ingest([target], '');

    render(
      <TestApp>
        <Note event={repost} />
      </TestApp>,
    );

    expect(await screen.findByText('the reposted words')).toBeTruthy();
    expect(screen.queryByText(/replying to/)).toBeNull();
  });
  it('renders the replied-to parent as a full note when it is in the store', async () => {
    const parent = note(generateSecretKey(), 'the parent words');
    const reply = finalizeEvent({
      kind: 1,
      created_at: parent.created_at + 5,
      tags: [['e', parent.id, '', 'reply'], ['p', parent.pubkey]],
      content: 'my reply',
    }, generateSecretKey());
    store.ingest([parent], '');

    render(
      <TestApp>
        <Note event={reply} />
      </TestApp>,
    );

    expect(await screen.findByText('my reply')).toBeTruthy();
    expect(screen.getByText('the parent words')).toBeTruthy();
    expect(screen.queryByText(/replying to/)).toBeTruthy();
  });
  it('a note with a malformed nostr: reference does not crash', async () => {
    render(
      <TestApp>
        <Note event={note(generateSecretKey(), 'nostr:npub1')} />
      </TestApp>,
    );

    // Renders the raw bech32 as plain text instead of throwing in nip19.decode.
    expect(await screen.findByText('npub1')).toBeTruthy();
  });
  it('opens a lightbox with all note images from a feed image click', async () => {
    const user = userEvent.setup();
    const event = note(
      generateSecretKey(),
      'two pics https://example.com/a.png and https://example.com/b.png',
    );

    render(
      <TestApp>
        <Note event={event} />
      </TestApp>,
    );

    // Both images render inline; clicking either opens the lightbox on it.
    const openers = await screen.findAllByRole('button', { name: 'open image' });
    expect(openers).toHaveLength(2);
    await user.click(openers[1]);

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img:not([aria-hidden])')).toHaveAttribute(
      'src',
      'https://example.com/b.png',
    );
    expect(screen.getAllByRole('button', { name: /^image \d$/ })).toHaveLength(2);
    expect(screen.queryByTestId('lightbox-counter')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'previous image' }));
    expect(screen.getByRole('dialog').querySelector('img:not([aria-hidden])')).toHaveAttribute(
      'src',
      'https://example.com/a.png',
    );
  });

  it('with media off, an image renders a click-to-load dud and no img', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({ mediaEnabled: false }));
    const user = userEvent.setup();
    const event = note(generateSecretKey(), 'gated pic https://example.com/a.png');

    render(
      <TestApp>
        <Note event={event} />
      </TestApp>,
    );

    // the dud shows the url and a load button; nothing is rendered as media
    expect(await screen.findByText('https://example.com/a.png')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'open image' })).toBeNull();
    expect(document.querySelector('img.max-h-96')).toBeNull();

    // clicking loads just that item
    await user.click(screen.getByRole('button', { name: 'load' }));
    await waitFor(() => {
      expect(document.querySelector('img.max-h-96')).toHaveAttribute('src', 'https://example.com/a.png');
    });
  });
  it('renders a longform as title, stripped body (clamped like a note) and cover — never raw markdown', async () => {
    const event = finalizeEvent({
      kind: 30023,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'a-longform'],
        ['title', 'the article headline'],
        ['image', 'https://example.com/cover.jpg'],
      ],
      content: `# raw markdown heading\n\n${'a long body paragraph. '.repeat(40)}`,
    }, generateSecretKey());

    render(
      <TestApp>
        <Note event={event} />
      </TestApp>,
    );

    expect(await screen.findByText('the article headline')).toBeTruthy();
    // markdown markers are stripped; the body shows as prose
    expect(screen.queryByText(/#/)).toBeNull();
    expect(screen.getByText(/a long body paragraph/)).toBeTruthy();
    // long body clamps with a read more, like every note
    expect(screen.getByRole('button', { name: /read more/ })).toBeTruthy();
    // the cover rides in the media grid, clickable into the lightbox
    expect(screen.getAllByRole('button', { name: 'open image' })).toHaveLength(1);
  });
});
