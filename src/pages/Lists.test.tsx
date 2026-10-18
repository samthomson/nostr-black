import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { FollowsPage } from './Lists';
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
  });
});

const nip19Of = (sk: Uint8Array): string => nip19.nsecEncode(sk);
