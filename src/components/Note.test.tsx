import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, nip19, verifyEvent } from 'nostr-tools';
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

    expect(await screen.findByText('relay down')).toBeTruthy();
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
