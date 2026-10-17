import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { ProfileEditDialog } from '@/components/ProfileEditDialog';
import { useKeystore } from '@/auth/useKeystore';
import { resetQueue } from '@/data/publish/queue';

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

/** A kind 0 carrying fields this app does not let you edit. */
const currentProfile = (sk: Uint8Array): NostrEvent => ({
  id: 'p'.repeat(64),
  pubkey: getPublicKey(sk),
  created_at: Math.floor(Date.now() / 1000),
  kind: 0,
  tags: [],
  content: JSON.stringify({
    display_name: 'Sam',
    name: 'sam',
    about: 'old about',
    picture: 'https://example.com/old.jpg',
    lud16: 'sam@example.com',
    bot: false,
    xmpp: 'sam@jabber.example',
  }),
  sig: 'f'.repeat(128),
});

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

const Harness = ({ sk, onClose }: { sk: Uint8Array; onClose?: () => void }) => (
  <Unlock nsec={nip19.nsecEncode(sk)}>
    <ProfileEditDialog open onOpenChange={onClose ?? vi.fn()} />
  </Unlock>
);

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('ProfileEditDialog', () => {
  it('edits a field and preserves every field the app does not edit', async () => {
    const sk = generateSecretKey();
    const existing = currentProfile(sk);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [existing] : []);

    const closed: boolean[] = [];
    const user = userEvent.setup();
    render(
      <TestApp>
        <Harness sk={sk} onClose={() => closed.push(true)} />
      </TestApp>,
    );

    const about = await screen.findByRole('textbox', { name: 'about' });
    expect(about).toHaveValue('old about');
    await user.clear(about);
    await user.type(about, 'new about');
    await user.click(screen.getByRole('button', { name: 'save profile' }));

    // The modal body is the field diff: old value in red, new in green —
    // the same git-diff language as the edit-history dialog.
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('about')).toBeTruthy();
    expect(within(modal).getByText('old', { exact: false })).toBeTruthy();
    expect(within(modal).getByText('new', { exact: false })).toBeTruthy();

    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(0);
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(getPublicKey(sk));

    // The merge: edited field changes, unknown fields survive untouched.
    const content = JSON.parse(event.content);
    expect(content.about).toBe('new about');
    expect(content.lud16).toBe('sam@example.com');
    expect(content.bot).toBe(false);
    expect(content.xmpp).toBe('sam@jabber.example');
    expect(content.display_name).toBe('Sam');
    expect(content.picture).toBe('https://example.com/old.jpg');

    // The editor closes once the broadcast is enqueued.
    await waitFor(() => expect(closed).toEqual([true]));
  });

  it('clearing a field removes it but leaves everything else', async () => {
    const sk = generateSecretKey();
    const existing = currentProfile(sk);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [existing] : []);

    const user = userEvent.setup();
    render(
      <TestApp>
        <Harness sk={sk} />
      </TestApp>,
    );

    const about = await screen.findByRole('textbox', { name: 'about' });
    await user.clear(about);
    await user.click(screen.getByRole('button', { name: 'save profile' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const content = JSON.parse(publish.mock.calls[0][0].content);
    expect('about' in content).toBe(false);
    expect(content.lud16).toBe('sam@example.com');
    expect(content.picture).toBe('https://example.com/old.jpg');
  });

  it('never saves when the existing profile content is unparseable', async () => {
    const sk = generateSecretKey();
    const existing = { ...currentProfile(sk), content: 'not json' };
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [existing] : []);

    render(
      <TestApp>
        <Harness sk={sk} />
      </TestApp>,
    );

    await screen.findByText(/can't be parsed/);
    expect(screen.getByRole('button', { name: 'save profile' })).toBeDisabled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('offers no save until something changed', async () => {
    const sk = generateSecretKey();
    const existing = currentProfile(sk);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [existing] : []);

    render(
      <TestApp>
        <Harness sk={sk} />
      </TestApp>,
    );

    await screen.findByRole('textbox', { name: 'about' });
    expect(screen.getByRole('button', { name: 'save profile' })).toBeDisabled();
  });
});
