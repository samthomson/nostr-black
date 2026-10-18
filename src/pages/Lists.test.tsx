import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { FollowsPage, MutesPage } from './Lists';
import { useKeystore } from '@/auth/useKeystore';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

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

beforeAll(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
});

describe('ListsPage', () => {
  it('shows public follows in the public section and move-to-private broadcasts kind 3', async () => {
    const sk = generateSecretKey();
    const alice = getPublicKey(generateSecretKey());
    const contactList = finalizeEvent(
      { kind: 3, created_at: 100, tags: [['p', alice]], content: '' }, sk,
    );
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(3)) return [contactList];
      return [];
    });

    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19Of(sk)}>
          <FollowsPage />
        </Unlock>
      </TestApp>,
    );

    // Alice in the public section, with the visible make-private action.
    await screen.findByRole('button', { name: 'make semi-private' });
    const row = screen.getByRole('button', { name: 'make semi-private' }).closest('div')?.parentElement;

    await user.click(screen.getAllByRole('button', { name: 'make semi-private' })[0]);

    // The modal previews the rebuild — confirm it.
    const dialog = await screen.findByRole('dialog');
    for (const b of await within(dialog).findAllByRole('button')) {
      if (/^(broadcast|upload .+ \+ broadcast)$/.test((b.textContent ?? '').trim())) {
        await user.click(b);
        break;
      }
    }
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(3);
    expect(event.content).not.toBe('');
    const publicTags = event.tags.filter(([n]) => n === 'p');
    expect(publicTags).toEqual([]);

    void row;

    // The move is reflected without reload: alice now sits in private.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'make semi-private' })).toBeNull());
  });

  it('private→public move broadcasts the follow back into tags', async () => {
    const sk = generateSecretKey();
    // Seeded kind 3: alice sealed privately.
    const { sealPrivateList } = await import('@/lib/outbox');
    const content = sealPrivateList(sk, [['p', alice]]);
    const contactList = finalizeEvent(
      { kind: 3, created_at: 100, tags: [], content }, sk,
    );
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(3) ? [contactList] : []);

    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19Of(sk)}>
          <FollowsPage />
        </Unlock>
      </TestApp>,
    );

    await screen.findByRole('button', { name: 'make public' });
    await user.click(screen.getByRole('button', { name: 'make public' }));

    const dialog = await screen.findByRole('dialog');
    for (const b of await within(dialog).findAllByRole('button')) {
      if (/^broadcast$/.test((b.textContent ?? '').trim())) {
        await user.click(b);
        break;
      }
    }
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.tags).toContainEqual(['p', alice]);
    expect(event.content).toBe('');
  });

  it('mute page moves a private mute to public as kind 10000', async () => {
    const sk = generateSecretKey();
    const { sealPrivateList } = await import('@/lib/outbox');
    const content = sealPrivateList(sk, [['p', alice]]);
    const muteListEvent = finalizeEvent(
      { kind: 10000, created_at: 100, tags: [], content }, sk,
    );
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(10000) ? [muteListEvent] : []);

    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19Of(sk)}>
          <MutesPage />
        </Unlock>
      </TestApp>,
    );

    await screen.findByRole('button', { name: 'make public' });
    await user.click(screen.getByRole('button', { name: 'make public' }));

    const dialog = await screen.findByRole('dialog');
    for (const b of await within(dialog).findAllByRole('button')) {
      if (/^broadcast$/.test((b.textContent ?? '').trim())) {
        await user.click(b);
        break;
      }
    }
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(10000);
    expect(event.tags).toContainEqual(['p', alice]);
  });

  it('make all private seals every public follow in one broadcast', async () => {
    const sk = generateSecretKey();
    const bob = getPublicKey(generateSecretKey());
    const contactList = finalizeEvent(
      { kind: 3, created_at: 100, tags: [['p', alice], ['p', bob]], content: '' }, sk,
    );
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(3) ? [contactList] : []);

    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19Of(sk)}>
          <FollowsPage />
        </Unlock>
      </TestApp>,
    );

    await screen.findByRole('button', { name: 'make all semi-private' });
    await user.click(screen.getByRole('button', { name: 'make all semi-private' }));
    // Confirm the bulk bar.
    await user.click(await screen.findByRole('button', { name: 'confirm' }));
    // Confirm the broadcast modal.
    const dialog = await screen.findByRole('dialog');
    for (const b of await within(dialog).findAllByRole('button')) {
      if (/^broadcast$/.test((b.textContent ?? '').trim())) {
        await user.click(b);
        break;
      }
    }
    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(3);
    expect(event.tags.filter(([n]) => n === 'p')).toEqual([]);
    expect(event.content).not.toBe('');
    // Both sealed follows decrypt back.
    const opened = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (() => { const { nip44 } = require('nostr-tools'); return nip44.v2.decrypt(event.content, nip44.v2.utils.getConversationKey(sk, getPublicKey(sk))); })(),
    ) as string[][];
    expect(opened).toEqual([['p', alice], ['p', bob]]);
  });

const nip19Of = (sk: Uint8Array): string => nip19.nsecEncode(sk);
const alice = getPublicKey(generateSecretKey());
});
