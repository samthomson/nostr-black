import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useEngagement } = await import('./useEngagement');
const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const NOTE = '1'.repeat(64);
const ALICE = 'a'.repeat(64);

const note: NostrEvent = {
  id: NOTE,
  pubkey: ALICE,
  created_at: 1,
  kind: 1,
  tags: [],
  content: 'hi',
  sig: 's'.repeat(128),
};

const reply = (pubkey: string): NostrEvent => ({
  id: pubkey.slice(0, 64),
  pubkey,
  created_at: 2,
  kind: 1,
  tags: [['e', NOTE]],
  content: 'a reply',
  sig: 's'.repeat(128),
});

const Counts = () => {
  const { replies, pending } = useEngagement(NOTE);
  return <div data-testid="n">{pending ? '…' : replies}</div>;
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

describe('useEngagement', () => {
  it('updates the reply count when replies land in the store, spinner until settled', async () => {
    store.ingest([note], 'wss://one/');
    queryRelay.mockResolvedValue([reply('b'.repeat(64)), reply('c'.repeat(64))]);

    render(<TestApp><Counts /></TestApp>);
    await settle();

    expect(screen.getByTestId('n')).toHaveTextContent('2');
  });
});
