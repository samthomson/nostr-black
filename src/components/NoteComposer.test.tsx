import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { NoteComposer } from '@/components/NoteComposer';
import { useKeystore } from '@/auth/useKeystore';
import { queuedEntries, resetQueue } from '@/data/publish/queue';
import { burnersOf, resetBurners } from '@/auth/burners';
import { store } from '@/data/store';

const publish = vi.fn<(event: { pubkey: string; kind: number }, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  publish: (...args: unknown[]) => publish(...(args as [{ pubkey: string; kind: number }, string[]])),
}));

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

const confirmBroadcast = async (user: { click: (el: Element) => Promise<void> }) => {
  await screen.findByRole('dialog');
  for (const b of await screen.findAllByRole('button')) {
    if ((b.textContent ?? '').trim() === 'broadcast') {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
};

beforeEach(() => {
  resetQueue();
  resetBurners();
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('NoteComposer', () => {
  it('clears the draft once the broadcast is enqueued', async () => {
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'ship it');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(box).toHaveValue(''));
    expect(publish).toHaveBeenCalled();
  });

  it('keeps the draft when the broadcast is cancelled', async () => {
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'stay');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    await user.click(await screen.findByRole('button', { name: 'cancel' }));

    expect(box).toHaveValue('stay');
    expect(queuedEntries()).toHaveLength(0);
  });

  it('remembers the burner pubkey so its notes count as yours', async () => {
    const sk = generateSecretKey();
    const identity = getPublicKey(sk);
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'anon today');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    // burner on: the modal re-previews with the throwaway identity
    await user.click(await screen.findByRole('switch', { name: 'broadcast via a burner' }));
    await confirmBroadcast(user);

    const [note] = publish.mock.calls[0];
    expect(note.pubkey).not.toBe(identity);
    expect(burnersOf(identity)).toContain(note.pubkey);
  });

  it('edits the note inside the broadcast modal, edit tab first, preview default', async () => {
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'first');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));

    // Opens on preview; the tab row starts with edit.
    await screen.findByRole('tab', { name: 'preview' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('edit');
    expect(tabs[0]).not.toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'edit' }));
    const editor = await screen.findByRole('textbox', { name: 'edit note' });
    await user.type(editor, ' pass');

    // The queued broadcast carries the edited content, and the commit
    // clears the page draft it was kept in sync with.
    await confirmBroadcast(user);
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [note] = publish.mock.calls.at(-1)!;
    expect((note as unknown as { content: string }).content).toBe('first pass');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('a typed mention publishes its NIP-27 p tag alongside the content entity', async () => {
    const sk = generateSecretKey();
    const skShan = generateSecretKey();
    const shan = getPublicKey(skShan);
    const profile = finalizeEvent({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ display_name: 'Shan' }),
    }, skShan);
    store.ingest([profile], '');
    const user = userEvent.setup();
    render(
      <TestApp userState={{ follows: { pubkeys: [shan], updatedAt: 1 } }}>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'hey @sha');
    const row = await screen.findByRole('option', { name: /Shan/ });
    await user.click(within(row).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [note] = publish.mock.calls[0];
    expect((note as unknown as { tags: string[][] }).tags).toContainEqual(['p', shan]);
    expect((note as unknown as { content: string }).content).toContain(`nostr:${nip19.npubEncode(shan)}`);
  });
  it('editing in the modal keeps the burner identity — never falls back to the real key', async () => {
    const sk = generateSecretKey();
    const identity = getPublicKey(sk);
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: "what's happening?" });
    await user.type(box, 'anon words');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    await user.click(await screen.findByRole('switch', { name: 'broadcast via a burner' }));

    // Edit the text in the modal after the toggle: the re-preview must
    // still be signed by the burner, not revert to the real identity.
    await user.click(screen.getByRole('tab', { name: 'edit' }));
    await user.type(screen.getByRole('textbox', { name: 'edit note' }), ' more');
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [note] = publish.mock.calls.at(-1)!;
    expect(note.pubkey).not.toBe(identity);
    expect((note as unknown as { content: string }).content).toBe('anon words more');
  });
});
