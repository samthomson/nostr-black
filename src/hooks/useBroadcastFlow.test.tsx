import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useBroadcastFlow, type PendingBroadcast } from '@/hooks/useBroadcastFlow';
import { resetQueue } from '@/data/publish/queue';

const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const Harness = ({ pending }: { pending: PendingBroadcast }) => {
  const { request, dialog } = useBroadcastFlow();
  return (
    <>
      <button type="button" onClick={() => request(pending)}>open</button>
      {dialog}
    </>
  );
};

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

const signedNote = (content: string): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: 1, tags: [], content }, generateSecretKey());

beforeEach(() => {
  resetQueue();
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('useBroadcastFlow deferred uploads', () => {
  it('runs uploads on confirm only, then builds and enqueues the events', async () => {
    const run = vi.fn(async () => [
      { url: 'https://cdn.example/a.png', sha256: 'a'.repeat(64), mime: 'image/png' },
    ]);
    const built = signedNote('before upload');
    const buildEvents = vi.fn((uploaded: readonly { url: string }[]) => [
      signedNote(`after ${uploaded[0]!.url}`),
      built,
    ]);
    const onEnqueued = vi.fn();
    const user = userEvent.setup();
    render(<Harness pending={{
      grade: 'public',
      label: 'note',
      content: 'note',
      identityPubkey: getPublicKey(generateSecretKey()),
      relays: ['wss://r/'],
      uploads: { count: 1, server: 'https://blossom.example', run },
      buildEvents,
      onEnqueued,
    }} />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    // the pending upload is stated; nothing has run yet
    const modal = await screen.findByRole('dialog');
    expect(modal.textContent).toContain('1 image');
    expect(run).not.toHaveBeenCalled();

    await confirmBroadcast(user);
    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(run).toHaveBeenCalledTimes(1);
    expect(buildEvents).toHaveBeenCalledTimes(1);
    expect(onEnqueued).toHaveBeenCalledTimes(1);
    // the enqueued events are the built ones, urls and all
    const [sent] = publish.mock.calls[0]!;
    expect((sent as { content: string }).content).toBe('after https://cdn.example/a.png');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an upload failure keeps the modal open with the error — retry or cancel, never a silent drop', async () => {
    const run = vi.fn<() => Promise<{ url: string; sha256: string; mime: string }[]>>(async () => {
      throw new Error('server unreachable');
    });
    const buildEvents = vi.fn(() => [signedNote('never')]);
    const onEnqueued = vi.fn();
    const user = userEvent.setup();
    render(<Harness pending={{
      grade: 'public',
      label: 'note',
      content: 'note',
      identityPubkey: getPublicKey(generateSecretKey()),
      relays: ['wss://r/'],
      uploads: { count: 1, server: 'https://blossom.example', run },
      buildEvents,
      onEnqueued,
    }} />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    await confirmBroadcast(user);
    expect(await screen.findByText(/upload failed: server unreachable/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
    expect(onEnqueued).not.toHaveBeenCalled();

    // the user retries and the server answers — same modal, same request
    run.mockResolvedValue([{ url: 'https://cdn.example/b.png', sha256: 'b'.repeat(64), mime: 'image/png' }]);
    await confirmBroadcast(user);
    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancelling never runs the uploads; plain events requests behave as before', async () => {
    const run = vi.fn(async () => []);
    const user = userEvent.setup();
    const event = signedNote('plain');
    const { rerender } = render(<Harness pending={{
      grade: 'public',
      label: 'note',
      content: 'plain',
      identityPubkey: event.pubkey,
      relays: ['wss://r/'],
      events: [event],
    }} />);

    // events built upfront: broadcast enqueues them directly
    await user.click(screen.getByRole('button', { name: 'open' }));
    await confirmBroadcast(user);
    await waitFor(() => expect(publish.mock.calls.some(([ev]) => ev.id === event.id)).toBe(true));

    rerender(<Harness pending={{
      grade: 'public',
      label: 'note',
      content: 'with image',
      identityPubkey: event.pubkey,
      relays: ['wss://r/'],
      uploads: { count: 1, server: 'https://blossom.example', run },
      buildEvents: () => [signedNote('deferred')],
    }} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByRole('button', { name: 'cancel' }));
    expect(run).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
