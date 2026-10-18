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
import { KIND_PRIVATE_REPLY, acceptConnection, makeRumor, openConnection, openPrivateReply, requestConnection, wrapPrivateNote, wrapPrivateReply } from '@/lib/feedEncryption';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decryptImage, encryptImage, mediaImagesOf, mediaTags, remintRumor } from '@/lib/fileMessage';
import type { UploadedBlob } from '@/net/blossom';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();
const fetchBlob = vi.fn<(url: string) => Promise<Uint8Array>>();
const uploadBlob = vi.fn<(bytes: Uint8Array, type: string, signWith: Uint8Array) => Promise<UploadedBlob>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

vi.mock('@/net/blossom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/blossom')>()),
  blossomBytes: (url: string) => fetchBlob(url),
  blossomUpload: (...args: unknown[]) => uploadBlob(...(args as [Uint8Array, string, Uint8Array])),
}));


const { scheduler } = await import('@/data/scheduler');
const { resetQueue } = await import('@/data/publish/queue');

/** Click the confirm button in the open broadcast modal — plain
 * "broadcast", or "upload N images + broadcast" when deferred uploads
 * ride the confirm. An upload run holds a 600ms narration beat before
 * the events enqueue, waited out in real time. */
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

/** Wait out the upload→broadcast narration beat in real time. */
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
  fetchBlob.mockReset();
  uploadBlob.mockReset();
  uploadBlob.mockResolvedValue({ sha256: 'ab'.repeat(32), url: 'https://cdn.example/reply.png', size: 64 });
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

  it('renders attached images decrypted from their rumors, never as urls or replies', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    // one image on the note, one on a reply — each an imeta tag riding
    // its own kind-1 rumor, encrypted under the conversation's reply CEK
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'root with a picture');
    const noteImage = encryptImage(replyCek, new Uint8Array([1, 2, 3, 4, 5]));
    const noteUploaded = { ...noteImage, mime: 'image/png', url: 'https://cdn.example/one' };
    const noteRumor = remintRumor(rumor, { tags: [...rumor.tags, ...mediaTags([noteUploaded], replyCek)] });
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], noteRumor);
    const replyBase = makeRumor(getPublicKey(bob), 'reply with a picture', [['e', noteRumor.id]]);
    const replyImage = encryptImage(replyCek, new Uint8Array([6, 7, 8, 9, 10]));
    const replyUploaded = { ...replyImage, mime: 'image/png', url: 'https://cdn.example/two' };
    const replyRumor = remintRumor(replyBase.rumor, { tags: [...replyBase.rumor.tags, ...mediaTags([replyUploaded], replyCek)] });
    const reply = wrapPrivateReply(bob, replyCek, replyRumor);
    // the tags parse back keyed to the conversation CEK
    expect(mediaImagesOf(noteRumor)[0]!.key).toBe(bytesToHex(replyCek));
    expect(mediaImagesOf(replyRumor)[0]!.key).toBe(bytesToHex(replyCek));

    fetchBlob.mockImplementation(async (url) => url.endsWith('/one') ? noteImage.ct : replyImage.ct);
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      if (filters[0]['#n']) return [reply];
      return [];
    });

    renderThread(nip19.nsecEncode(bob), noteRumor.id);
    await settle();
    await settle();
    await settle();

    expect(await screen.findByText('root with a picture')).toBeTruthy();
    const images = await waitFor(() => {
      const found = [...document.querySelectorAll('img.max-h-96')];
      expect(found).toHaveLength(2);
      return found;
    });
    for (const img of images) expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.queryByText('https://cdn.example/one')).toBeNull();
    expect(screen.queryByText('https://cdn.example/two')).toBeNull();
    // the media tags are not replies: one text reply renders, and
    // only bob's own reply carries an edit button
    expect(screen.getAllByText('reply with a picture')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'edit note' })).toHaveLength(1);
    // grouping: the note's image sits under the note, the reply's under the reply
    const replyText = screen.getByText('reply with a picture');
    expect(images[0]!.compareDocumentPosition(replyText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(replyText.compareDocumentPosition(images[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with media off, a private image renders a dud and its ciphertext is never fetched', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({ mediaEnabled: false }));
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'secret with a picture');
    const image = encryptImage(replyCek, new Uint8Array([1, 2, 3, 4, 5]));
    const uploaded = { ...image, mime: 'image/png', url: 'https://cdn.example/one' };
    const mediaRumor = remintRumor(rumor, { tags: [...rumor.tags, ...mediaTags([uploaded], replyCek)] });
    const [note] = wrapPrivateNote(alice, [getPublicKey(bob)], mediaRumor);

    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(30378)) return [accepted];
      if (filters[0]['#f']) return [note];
      return [];
    });

    renderThread(nip19.nsecEncode(bob), mediaRumor.id);
    await settle();
    await settle();
    await settle();

    // the dud shows the url with a load button; the ciphertext — a read
    // receipt for the hosting server — is never fetched
    expect(await screen.findByText('secret with a picture')).toBeTruthy();
    expect(screen.getByText('https://cdn.example/one')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'load' })).toBeTruthy();
    expect(fetchBlob).not.toHaveBeenCalled();
    // clicking loads just that image, capped at the configured max
    fetchBlob.mockResolvedValue(image.ct);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'load' }));
    await waitFor(() => {
      expect(fetchBlob).toHaveBeenCalledWith('https://cdn.example/one');
    });
    await waitFor(() => {
      expect(document.querySelector('img.max-h-96')?.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  it('replying with an image uploads its ciphertext only after confirm; the imeta tag rides the reply rumor', async () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const offer = requestConnection(alice, getPublicKey(bob));
    const accepted = acceptConnection(bob, openConnection(bob, offer));
    const { rumor, replyCek } = makeRumor(getPublicKey(alice), 'root secret');
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
    await user.type(box, 'sealed answer with a picture');
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(picker).toBeTruthy();
    await user.upload(picker!, new File([new Uint8Array([9, 8, 7])], 'pic.png', { type: 'image/png' }));

    await user.click(screen.getByRole('button', { name: 'reply' }));
    const modal = await screen.findByRole('dialog');
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(modal.textContent).toContain('1 image');
    // the thread fetches the ciphertext as soon as the reply re-renders —
    // serve whatever the upload actually sent
    fetchBlob.mockImplementation(async () => uploadBlob.mock.calls[0]![0]);
    await confirmBroadcast(user);
    await act(broadcastBeat);
    await settle();

    // only ciphertext left the device
    expect(uploadBlob).toHaveBeenCalledTimes(1);
    const [sentBytes] = uploadBlob.mock.calls[0]!;
    expect(sentBytes).not.toEqual(new Uint8Array([9, 8, 7]));

    // one sealed reply carries everything — no second event for the image
    const sent = publish.mock.calls.map(([ev]) => ev).filter((ev) => ev.kind === KIND_PRIVATE_REPLY);
    expect(sent).toHaveLength(1);
    const replyRumor = openPrivateReply(replyCek, sent[0]!);
    expect(replyRumor.kind).toBe(1);
    expect(replyRumor.content).toBe('sealed answer with a picture');
    // the parent stays a plain e tag; the image is attached, not e-embedded
    expect(replyRumor.tags.filter(([n]) => n === 'e')).toEqual([['e', rumor.id]]);
    const images = mediaImagesOf(replyRumor);
    expect(images).toHaveLength(1);
    expect(images[0]!.url).toBe('https://cdn.example/reply.png');
    expect(images[0]!.mime).toBe('image/png');
    expect(images[0]!.x).toBe(bytesToHex(sha256(sentBytes)));
    expect(images[0]!.ox).toBe(bytesToHex(sha256(new Uint8Array([9, 8, 7]))));
    expect(images[0]!.key).toBe(bytesToHex(replyCek));
    expect(decryptImage(images[0]!.key, images[0]!.nonce, sentBytes)).toEqual(new Uint8Array([9, 8, 7]));

    // the thread renders the new reply with its decrypted image — the
    // ciphertext url itself never shows as text
    const shown = await waitFor(() => {
      const found = [...document.querySelectorAll('img.max-h-96')];
      expect(found).toHaveLength(1);
      return found[0]!;
    });
    expect(shown.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.queryByText('https://cdn.example/reply.png')).toBeNull();
  });
});
