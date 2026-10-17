import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { FOLLOWER_CAP } from '@/data/scheduler';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useFollowers } = await import('./useFollowers');
const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'a'.repeat(64);

const follow = (pubkey: string, target: string): NostrEvent => ({
  id: pubkey.slice(0, 63) + '3',
  pubkey,
  created_at: 1000,
  kind: 3,
  tags: [['p', target]],
  content: '',
  sig: 's'.repeat(128),
});

const Sample = () => {
  const { count, capped, pending } = useFollowers(ALICE);
  if (pending) return <div data-testid="followers">loading</div>;
  return <div data-testid="followers">{count}{capped ? '+' : ''}</div>;
};

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

describe('useFollowers', () => {
  it('counts unique authors of kind 3 lists that tag this pubkey', async () => {
    const bob = 'b'.repeat(64);
    const carol = 'c'.repeat(64);
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(3) && filters[0]['#p']
        ? [follow(bob, ALICE), follow(carol, ALICE), follow(bob, ALICE)]
        : []);

    render(<TestApp><Sample /></TestApp>);
    await settle();

    expect(screen.getByTestId('followers')).toHaveTextContent('2');
  });

  it('marks the count as a floor when the fetch hits the cap', async () => {
    const events = Array.from({ length: FOLLOWER_CAP }, (_, i) =>
      follow(i.toString(16).padStart(64, '0'), ALICE));
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.includes(3) && filters[0]['#p'] ? events : []);

    render(<TestApp><Sample /></TestApp>);
    await settle();

    expect(screen.getByTestId('followers')).toHaveTextContent(`${FOLLOWER_CAP}+`);
  });
});
