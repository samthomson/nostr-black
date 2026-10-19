import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import PrivateFeedPage from '@/pages/PrivateFeed';
import { useKeystore } from '@/auth/useKeystore';
import { KIND_PRIVATE_REPLY, acceptConnection, closeConnection, makeRumor, noteIdOf, openConnection, openPrivateNote, openPrivateReply, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/feedEncryption';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decryptImage, mediaImagesOf } from '@/lib/fileMessage';
import type { UploadedBlob } from '@/net/blossom';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();
const uploadBlob = vi.fn<(bytes: Uint8Array, type: string, signWith: Uint8Array) => Promise<UploadedBlob>>();
const fetchBlob = vi.fn<(url: string) => Promise<Uint8Array>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

vi.mock('@/net/blossom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/blossom')>()),
  blossomUpload: (...args: unknown[]) => uploadBlob(...(args as [Uint8Array, string, Uint8Array])),
  blossomBytes: (url: string) => fetchBlob(url),
}));

const { scheduler } = await import('@/data/scheduler');
const { resetQueue } = await import('@/data/publish/queue');
const { store } = await import('@/data/store');


/** Click the confirm button in the open broadcast modal — plain
 * "broadcast", or "upload N images + broadcast" when deferred uploads
 * ride the confirm. An upload run holds a 600ms narration beat before
 * the events enqueue; mock timers must be installed so the beat is
 * crossed, and `advanceBroadcastBeat` fires it. */
const confirmBroadcast = async (user: { click: (el: Element) => Promise<void> }) => {
  const dialog = await screen.findByRole('dialog');
  for (const b of await within(dialog).findAllByRole('button')) {
    if (/(^|\+\s)broadcast$/.test((b.textContent ?? '').trim())) {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
};

/** Wait out the upload→broadcast narration beat in real time — fake
 * timers stall the publish scheduler's own debounce, so they can't
 * carry the confirm run. */
const broadcastBeat = async (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 700);
  await promise;
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
  uploadBlob.mockReset();
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
    expect(screen.getByText(/only once you've connected with people/)).toBeTruthy();
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
    // Closed in the feed, like the public feed: no reply text, no composer.
    expect(screen.queryByText('secret reply from bob')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'reply' })).toBeNull();

    // The reply count routes to the note's thread page — same opening
    // gesture as the public feed.
    const count = await waitFor(() => {
      const el = screen.getByTestId('count-reply');
      expect(el.tagName).toBe('A');
      return el;
    });
    expect(count.getAttribute('href')).toBe(`/private-feed/${nip19.neventEncode({ id: rumor.id, author: rumor.pubkey, relays: [] })}`);

    // The info dialog points at the wrapper — the event relays hold —
    // and decodes it layer by layer: wrapper, seal, rumour.
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'event info' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('event info')).toBeTruthy();
    expect(within(dialog).getByText('1370')).toBeTruthy();
    expect(within(dialog).getByText(/rumour/)).toBeTruthy();
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


  it('edits a private note inside the broadcast modal before committing', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
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

    const box = await screen.findByRole('textbox', { name: 'what are you doing?' });
    await userEvent.setup().type(box, 'secret one');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'broadcast' }));

    // Same modal contract as the public composer: edit tab first, opens on preview.
    const tabs = await screen.findAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('edit');
    await user.click(screen.getByRole('tab', { name: 'edit' }));
    const editor = screen.getByRole('textbox', { name: 'edit note' });
    await user.type(editor, ' two');
    await confirmBroadcast(user);
    await settle();

    // The sealed wrapper that went out opens back with the edited content.
    const wrapper = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1370);
    expect(wrapper).toBeTruthy();
    expect(openPrivateNote(alice, wrapper!).rumor.content).toBe('secret one two');
    await waitFor(() => expect(box).toHaveValue(''));
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
    await settle();

    // One slotless conversation event under the reply CEK: bob holds the
    // key regardless of connection state, and finds it by #n.
    const revision = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1470);
    expect(revision).toBeTruthy();
    expect(revision!.tags).toContainEqual(['n', noteIdOf(replyCek)]);
  });

  it('a private mention: typeahead pick publishes the entity and its p tag inside the sealed rumor, and the feed renders the name', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const bobProfile = finalizeEvent({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ display_name: 'Shan' }),
    }, bob);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0].kinds?.includes(0)) return [bobProfile];
      return [];
    });

    render(
      <TestApp userState={{ follows: { pubkeys: [getPublicKey(bob)], updatedAt: 1 } }}>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <PrivateFeedPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();
    await settle();

    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: 'what are you doing?' });
    await user.type(box, 'secret hi @sha');
    const row = await screen.findByRole('option', { name: /Shan/ });
    await user.click(within(row).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    await confirmBroadcast(user);
    await settle();

    // The sealed wrapper opens back with the entity in the content and
    // the mention p tag on the rumor — nothing readable on the wrapper.
    const wrapper = publish.mock.calls.map(([ev]) => ev).find((ev) => ev.kind === 1370)!;
    const opened = openPrivateNote(alice, wrapper);
    expect(opened.rumor.content).toContain(`nostr:${nip19.npubEncode(getPublicKey(bob))}`);
    expect(opened.rumor.tags).toContainEqual(['p', getPublicKey(bob)]);
    expect(wrapper.content).not.toContain(getPublicKey(bob));

    // The feed renders the mention as the person's name.
    expect(await screen.findByText(/Shan/)).toBeTruthy();
  });

  it('sends staged images as imeta tags on the note itself — ciphertext uploaded only once the modal confirms', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      return [];
    });
    uploadBlob.mockResolvedValue({ sha256: 'ab'.repeat(32), url: 'https://cdn.example/staged.png', size: 64 });

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(alice)}>
          <PrivateFeedPage />
        </Unlock>
      </TestApp>,
    );
    await settle();
    await settle();

    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: 'what are you doing?' });
    await user.type(box, 'with a picture');
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(picker).toBeTruthy();
    await user.upload(picker!, new File([new Uint8Array([9, 8, 7])], 'pic.png', { type: 'image/png' }));
    // the staged image previews in the composer's thumbnail strip
    expect(document.querySelector('img.size-16')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    // nothing leaves before the modal confirms — the upload line states it
    const modal = await screen.findByRole('dialog');
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(modal.textContent).toContain('1 image');
    // the preview tab shows the staged picture — the local blob, not
    // the uploaded url (the bytes have not left the device yet)
    const modalImg = modal.querySelector('img[src^="blob:"]');
    expect(modalImg).toBeTruthy();
    const composerThumb = document.querySelector('img.size-16') as HTMLImageElement;
    expect(modalImg!.getAttribute('src')).toBe(composerThumb.getAttribute('src'));
    // the feed fetches the ciphertext as soon as the note re-renders —
    // serve whatever the upload actually sent
    fetchBlob.mockImplementation(async () => uploadBlob.mock.calls[0]![0]);
    await confirmBroadcast(user);
    await act(broadcastBeat);
    await settle();
    // only ciphertext left the device, and only now
    expect(uploadBlob).toHaveBeenCalledTimes(1);
    const [sentBytes] = uploadBlob.mock.calls[0]!;
    expect(sentBytes).not.toEqual(new Uint8Array([9, 8, 7]));
    // one event per note: the 1370 set is the whole broadcast — an
    // attached image adds nothing beyond what a text note produces
    const published = publish.mock.calls.map(([ev]) => ev);
    expect(published.map((ev) => ev.kind)).toEqual([1370]);
    const noteWrapper = published.find((ev) => ev.kind === 1370)!;

    const openedNote = openPrivateNote(alice, noteWrapper);
    expect(openedNote.rumor.kind).toBe(1);
    expect(openedNote.rumor.content).toBe('with a picture');
    // the image rides its note: one imeta tag pointing at the uploaded
    // ciphertext, x and ox committing to it and the plaintext, its
    // decryption-key the conversation CEK that opens it
    const images = mediaImagesOf(openedNote.rumor);
    expect(images).toHaveLength(1);
    expect(images[0]!.url).toBe('https://cdn.example/staged.png');
    expect(images[0]!.mime).toBe('image/png');
    expect(images[0]!.x).toBe(bytesToHex(sha256(sentBytes)));
    expect(images[0]!.ox).toBe(bytesToHex(sha256(new Uint8Array([9, 8, 7]))));
    expect(images[0]!.key).toBe(bytesToHex(openedNote.replyCek));
    expect(decryptImage(images[0]!.key, images[0]!.nonce, sentBytes)).toEqual(new Uint8Array([9, 8, 7]));

    // the feed re-renders the note with its decrypted image
    const shown = await waitFor(() => {
      const found = [...document.querySelectorAll('img.max-h-96')];
      expect(found).toHaveLength(1);
      return found[0]!;
    });
    expect(shown.getAttribute('src')).toMatch(/^blob:/);
    // the image is not a reply: no url text, and the reply count stays zero
    expect(screen.queryByText('https://cdn.example/staged.png')).toBeNull();
    expect(screen.getByTestId('count-reply').textContent).toBe('0');

    // the decrypted image opens the note's lightbox — the same ux as the
    // public feed, wearing the private grade
    await user.click(screen.getByRole('button', { name: 'open image' }));
    const lightbox = await screen.findByRole('dialog');
    expect(lightbox.style.backgroundColor).toBe('var(--privacy-private)');
    expect(lightbox.querySelector('img:not([aria-hidden])')).toHaveAttribute('src', shown.getAttribute('src')!);
    // single image: no navigation dots or arrows
    expect(screen.queryByTestId('lightbox-nav')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // enqueue is the commit point: the draft and the staged thumbnails clear
    await waitFor(() => expect(box).toHaveValue(''));
    expect(document.querySelector('img.size-16')).toBeNull();
  });
});
