import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { ProfilePage } from '@/pages/Profile';
import { FEED_KINDS } from '@/data/feed/spec';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'c'.repeat(64);

const note = (content: string): NostrEvent => ({
  id: '1'.repeat(64),
  pubkey: ALICE,
  created_at: 1,
  kind: 1,
  tags: [],
  content,
  sig: 's'.repeat(128),
});

const relaysOf = (): NostrEvent => ({
  id: 'r'.repeat(64),
  pubkey: ALICE,
  created_at: 1,
  kind: 10002,
  tags: [['r', 'wss://alice-out/', 'write']],
  content: '',
  sig: 's'.repeat(128),
});

const settle = async () => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await scheduler.flush(); });
};

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  scheduler.reset();
  store.clear();
});

describe('ProfilePage', () => {
  it('shows fetching events while the author outbox has not answered', async () => {
    queryRelay.mockImplementation(() => new Promise(() => {}));

    render(
      <TestApp>
        <ProfilePage pubkey={ALICE} />
      </TestApp>,
    );

    expect(await screen.findByText(/fetching events/)).toBeTruthy();
    expect(screen.queryByText('no notes found on their relays')).toBeNull();
    expect(screen.queryByText("couldn't find where this author publishes (no NIP-65 list)")).toBeNull();
  });

  it('drops the fetching bar once notes land', async () => {
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(10002)) return [relaysOf()];
      if (filters[0].kinds?.some((k) => FEED_KINDS.includes(k))) return [note('hello from outbox')];
      return [];
    });

    render(
      <TestApp>
        <ProfilePage pubkey={ALICE} />
      </TestApp>,
    );
    await settle();
    await settle();

    expect(await screen.findByText('hello from outbox')).toBeTruthy();
    expect(screen.queryByText(/fetching events/)).toBeNull();
    expect(screen.getByText('1 notes')).toBeTruthy();
  });
});
