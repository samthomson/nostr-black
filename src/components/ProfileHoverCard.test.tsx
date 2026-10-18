import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { resetQueue, queuedEntries } from '@/data/publish/queue';
import { TestApp } from '@/test/TestApp';
import { Note } from '@/components/Note';
import { useKeystore } from '@/auth/useKeystore';
import { useLayoutEffect, type ReactNode } from 'react';

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

const note = (sk: Uint8Array, content: string): NostrEvent =>
  finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  }, sk);

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

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('ProfileHoverCard', () => {
  it('opens on hover with identity and follow state — closed by default', async () => {
    const alice = generateSecretKey();
    const event = note(alice, 'hover me');
    const user = userEvent.setup();

    render(
      <TestApp>
        <Note event={event} />
      </TestApp>,
    );

    // Closed: no follow button anywhere.
    expect(screen.queryByRole('button', { name: 'follow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'unfollow' })).toBeNull();

    // Hover the author name.
    await user.hover(await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(getPublicKey(alice)).slice(0, 10)) }));

    // The card opens with the full npub (CSS-truncated to fit) + copy.
    const npub = nip19.npubEncode(getPublicKey(alice));
    expect(await screen.findByText(npub)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'copy npub' })).toBeTruthy();
    const follow = screen.getByRole('button', { name: 'follow' });
    expect(follow).toBeTruthy();
    expect(queuedEntries()).toHaveLength(0);
  });

  it('shows "unfollow" when the synced kind 3 tags the author', async () => {
    const alice = generateSecretKey();
    const event = note(alice, 'followed author');
    const user = userEvent.setup();

    render(
      <TestApp
        userState={{ follows: { pubkeys: [getPublicKey(alice)], updatedAt: 1 } }}
      >
        <Note event={event} />
      </TestApp>,
    );

    await user.hover(await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(getPublicKey(alice)).slice(0, 10)) }));
    expect(await screen.findByRole('button', { name: 'unfollow' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^follow$/ })).toBeNull();
  });

  it('follow broadcasts a signed kind 3 through the standard modal', async () => {
    const alice = generateSecretKey();
    const me = generateSecretKey();
    const event = note(alice, 'follow target');
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(me)}>
          <Note event={event} />
        </Unlock>
      </TestApp>,
    );

    await user.hover(await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(getPublicKey(alice)).slice(0, 10)) }));
    await user.click(await screen.findByRole('button', { name: 'follow' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [contactList] = publish.mock.calls[0]!;
    expect(contactList.kind).toBe(3);
    expect(contactList.pubkey).toBe(getPublicKey(me));
    expect(contactList.tags).toContainEqual(['p', getPublicKey(alice)]);
    expect(verifyEvent(contactList)).toBe(true);
  });

  it('connect broadcasts a kind 30378 request through the standard modal', async () => {
    const alice = generateSecretKey();
    const me = generateSecretKey();
    const event = note(alice, 'connect target');
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(me)}>
          <Note event={event} />
        </Unlock>
      </TestApp>,
    );

    await user.hover(await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(getPublicKey(alice)).slice(0, 10)) }));
    await user.click(await screen.findByRole('button', { name: 'connect' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [request] = publish.mock.calls[0]!;
    expect(request.kind).toBe(30378);
    expect(verifyEvent(request)).toBe(true);
    // A pairwise envelope: only alice's copy of the derived key opens
    // the payload — the content is an opaque envelope, not the parties.
    expect(request.content).not.toContain(getPublicKey(me));
    expect(request.content).not.toContain(getPublicKey(alice));
  });

  it('no connect button for yourself', async () => {
    const me = generateSecretKey();
    const event = note(me, 'my own note');
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(me)}>
          <Note event={event} />
        </Unlock>
      </TestApp>,
    );

    await user.hover(await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(getPublicKey(me)).slice(0, 10)) }));
    expect(await screen.findByRole('button', { name: 'follow' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'connect' })).toBeNull();
  });
});
