import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { NoteComposer } from '@/components/NoteComposer';
import { useKeystore } from '@/auth/useKeystore';
import { queuedEntries, resetQueue } from '@/data/publish/queue';
import { burnersOf, resetBurners } from '@/auth/burners';

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

    const box = await screen.findByRole('textbox', { name: 'write a note' });
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

    const box = await screen.findByRole('textbox', { name: 'write a note' });
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

    const box = await screen.findByRole('textbox', { name: 'write a note' });
    await user.type(box, 'anon today');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    // burner on: the modal re-previews with the throwaway identity
    await user.click(await screen.findByRole('switch', { name: 'broadcast via a burner' }));
    await confirmBroadcast(user);

    const [note] = publish.mock.calls[0];
    expect(note.pubkey).not.toBe(identity);
    expect(burnersOf(identity)).toContain(note.pubkey);
  });
});
