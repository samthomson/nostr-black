import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { useBroadcastFlow, type PendingBroadcast } from '@/hooks/useBroadcastFlow';
import { useKeystore } from '@/auth/useKeystore';
import { queuedEntries, resetQueue } from '@/data/publish/queue';

const queryRelay = vi.fn<() => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: () => queryRelay(),
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

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

/** Upload progress reporting from a deferred run. */
export interface UploadProgress {
  (done: number, total: number, loaded: number, fileBytes: number): void;
}

/** One uploaded file as the broadcast builders receive it. */
export interface UploadedFileFixture {
  url: string;
  sha256: string;
  mime: string;
}

/** A button that requests a two-image broadcast whose upload progress we
 *  control and can fail once. */
const Harness = ({ run }: { run: (onProgress?: UploadProgress) => Promise<UploadedFileFixture[]> }) => {
  const { request, dialog } = useBroadcastFlow();
  const broadcast: PendingBroadcast = {
    grade: 'public',
    label: 'note',
    content: 'with images',
    identityPubkey: getPublicKey(generateSecretKey()),
    relays: ['wss://relay.example/'],
    uploads: {
      count: 2,
      server: 'https://blossom.example/',
      run,
    },
    // The builders receive the uploaded files — build straight from them,
    // no state round-trip (a closure over render state would see stale
    // values when the deferred run resolves).
    buildEvents: (uploaded) => [{
      id: 'a'.repeat(64),
      pubkey: getPublicKey(generateSecretKey()),
      created_at: 1,
      kind: 1,
      tags: uploaded.map((file) => ['url', file.url]),
      content: 'built',
      sig: 'f'.repeat(128),
    }],
  };
  return (
    <>
      <button type="button" onClick={() => request(broadcast)}>request</button>
      {dialog}
    </>
  );
};

const confirm = async (user: ReturnType<typeof userEvent.setup>) => {
  const dialog = await screen.findByRole('dialog');
  for (const b of await within(dialog).findAllByRole('button')) {
    if (/upload .+ \+ broadcast/.test((b.textContent ?? '').trim())) {
      await user.click(b);
      return;
    }
  }
  throw new Error('upload+broadcast button not found');
};

describe('upload progress and failure handling', () => {
  it('shows the progress bar filling, then commits', async () => {
    const user = userEvent.setup();
    const sk = generateSecretKey();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Harness run={async (onProgress) => {
            onProgress?.(0, 2, 300, 1000);
            onProgress?.(0, 2, 1000, 1000);
            onProgress?.(1, 2, 500, 800);
            onProgress?.(1, 2, 800, 800);
            return [
              { url: 'https://blossom.example/a', sha256: 'a'.repeat(64), mime: 'image/webp' },
              { url: 'https://blossom.example/b', sha256: 'b'.repeat(64), mime: 'image/webp' },
            ];
          }} />
        </Unlock>
      </TestApp>,
    );

    await user.click(screen.getByRole('button', { name: 'request' }));
    await user.click(await screen.findByRole('button', { name: 'upload 2 images + broadcast' }));

    // The bar and the image counter appear during the upload.
    await screen.findByText(/1\/2 uploading images/);
    expect(screen.getByText(/uploading images/).textContent).toMatch(/1\/2/);

    // Commit lands: the event reaches the queue and the wire.
    await waitFor(() => expect(queuedEntries().length + (publish.mock.calls.length)).toBeGreaterThan(0));
    await waitFor(() => expect(publish).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('a failed upload keeps the modal open with the error and a retry', async () => {
    const user = userEvent.setup();
    const sk = generateSecretKey();
    let attempts = 0;
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Harness run={async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('blossom upload failed: 502');
            return [
              { url: 'https://blossom.example/a', sha256: 'a'.repeat(64), mime: 'image/webp' },
              { url: 'https://blossom.example/b', sha256: 'b'.repeat(64), mime: 'image/webp' },
            ];
          }} />
        </Unlock>
      </TestApp>,
    );

    await user.click(screen.getByRole('button', { name: 'request' }));
    await confirm(user);

    // The error surfaces inline, with the retry hint.
    expect(await screen.findByText(/upload failed: 502/)).toBeTruthy();
    expect(screen.getByText(/retry, or cancel/)).toBeTruthy();

    // Retry: the same run goes again, this time succeeding.
    await user.click(await screen.findByRole('button', { name: 'retry upload + broadcast' }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(publish).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('cancel after a failure closes the modal without publishing', async () => {
    const user = userEvent.setup();
    const sk = generateSecretKey();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Harness run={async () => { throw new Error('network error'); }} />
        </Unlock>
      </TestApp>,
    );

    await user.click(screen.getByRole('button', { name: 'request' }));
    await confirm(user);
    await screen.findByText(/upload failed/);
    await user.click(screen.getByRole('button', { name: 'cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(publish).not.toHaveBeenCalled();
  });
});

