import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { NoteComposer } from '@/components/NoteComposer';
import { useKeystore } from '@/auth/useKeystore';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const { resetQueue } = await import('@/data/publish/queue');

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

const parent = (sk: Uint8Array): NostrEvent =>
  finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: 'the root post',
  }, sk);

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('NoteComposer reply mode', () => {
  it('broadcasts a NIP-10 reply addressed to the parent', async () => {
    const sk = generateSecretKey();
    const root = parent(sk);
    const user = userEvent.setup();

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <NoteComposer parent={root} />
        </Unlock>
      </TestApp>,
    );

    const box = await screen.findByRole('textbox', { name: 'reply…' });
    await user.type(box, 'a public reply');
    await user.click(screen.getByRole('button', { name: 'reply' }));

    // the modal previews a reply, not a plain note
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('reply');

    for (const b of await within(dialog).findAllByRole('button')) {
      if ((b.textContent ?? '').trim() === 'broadcast') await user.click(b);
    }

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [sent] = publish.mock.calls[0];
    expect(sent.kind).toBe(1);
    expect(sent.content).toBe('a public reply');
    // addressed the parent as the thread root, tagged its author
    expect(sent.tags).toContainEqual(['e', root.id, '', 'root']);
    expect(sent.tags).toContainEqual(['p', root.pubkey]);
  });
});
