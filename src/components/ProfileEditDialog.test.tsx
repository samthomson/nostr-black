import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
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

vi.mock('@/net/blossom', () => ({
  blossomUpload: async () => ({ sha256: 'a'.repeat(64), url: 'https://blossom.test/a.png', size: 4 }),
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
    if (/^(broadcast|upload .+ \+ broadcast)$/.test((b.textContent ?? '').trim())) {
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

  it('a staged picture shows a thumbnail, never a blob url — and a cancelled pick cannot leak into a later save', async () => {
    const sk = generateSecretKey();
    const existing = currentProfile(sk);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [existing] : []);

    const gate: { set?: (open: boolean) => void } = {};
    const Gate = ({
      sk: key,
      onReady,
    }: {
      sk: Uint8Array;
      onReady: (set: (open: boolean) => void) => void;
    }) => {
      const [open, set] = useState(true);
      onReady(set);
      return (
        <Unlock nsec={nip19.nsecEncode(key)}>
          {open ? (
            <ProfileEditDialog open={open} onOpenChange={set} />
          ) : (
            <button type="button" onClick={() => set(true)}>reopen</button>
          )}
        </Unlock>
      );
    };

    const user = userEvent.setup();
    render(
      <TestApp>
        <Gate sk={sk} onReady={(set) => { gate.set = set; }} />
      </TestApp>,
    );

    const picture = await screen.findByRole('textbox', { name: 'picture url' });
    expect(picture).toHaveValue('https://example.com/old.jpg');

    // Stage a file: thumbnail + name under the input; the input keeps
    // its url text — no blob: ever lands there.
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'avatar.png', { type: 'image/png' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });
    expect(picture).toHaveValue('https://example.com/old.jpg');
    expect(screen.getByText('avatar.png')).toBeTruthy();
    expect(document.querySelector('img[src^="blob:"]')).toBeTruthy();

    // Cancel, then reopen: the session reset — no thumbnail, no staged
    // file, and save is disabled again (nothing carries over).
    gate.set!(false);
    await user.click(await screen.findByRole('button', { name: 'reopen' }));
    await screen.findByRole('textbox', { name: 'picture url' });
    expect(screen.queryByText('avatar.png')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'picture url' })).toHaveValue('https://example.com/old.jpg');
    expect(screen.getByRole('button', { name: 'save profile' })).toBeDisabled();
  });

  it('a staged picture uploads on confirm and closes the editor', async () => {
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

    await screen.findByRole('textbox', { name: 'picture url' });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'avatar.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    await user.click(screen.getByRole('button', { name: 'save profile' }));
    await confirmBroadcast(user);

    // The kind 0 that leaves carries the uploaded url, never the blob.
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const content = JSON.parse(publish.mock.calls[0][0].content);
    expect(content.picture).not.toContain('blob:');
    await waitFor(() => expect(closed).toEqual([true]));
  });

  it('an unsupported image type is named inline, never staged', async () => {
    const sk = generateSecretKey();
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(0) ? [currentProfile(sk)] : []);

    render(
      <TestApp>
        <Harness sk={sk} />
      </TestApp>,
    );

    await screen.findByRole('textbox', { name: 'picture url' });
    // A paste can carry anything the (filtered) picker wouldn't offer.
    const heic = new File([new Uint8Array([1])], 'photo.heic', { type: 'image/heic' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [heic] },
    });
    expect(await screen.findByText(/photo\.heic: not jpg, png, webp or gif/)).toBeTruthy();
    expect(document.querySelector('img[src^="blob:"]')).toBeNull();

    // Nothing staged — no thumbnail, no dirty form.
    expect(screen.getByRole('button', { name: 'save profile' })).toBeDisabled();
  });
});
