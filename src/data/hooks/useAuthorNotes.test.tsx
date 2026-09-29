import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { FEED_KINDS } from '@/data/feed/spec';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useAuthorNotes } = await import('./useAuthorNotes');
const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'a'.repeat(64);

const note = (id: string, created_at: number): NostrEvent => ({
  id: id.repeat(64).slice(0, 64),
  pubkey: ALICE,
  created_at,
  kind: 1,
  tags: [],
  content: id,
  sig: 's'.repeat(128),
});

const relaysOf = (write: string): NostrEvent => ({
  id: 'r'.repeat(64),
  pubkey: ALICE,
  created_at: 1,
  kind: 10002,
  tags: [['r', write, 'write']],
  content: '',
  sig: 's'.repeat(128),
});

const Notes = () => {
  const { notes, pending } = useAuthorNotes(ALICE);
  if (pending && notes.length === 0) return <div data-testid="notes">loading</div>;
  return <div data-testid="notes">{notes.map((e) => e.content).join(',')}</div>;
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

describe('useAuthorNotes', () => {
  it('returns the author notes newest-first from the store', async () => {
    queryRelay.mockImplementation(async (_url, filters) =>
      filters[0].kinds?.some((k) => FEED_KINDS.includes(k))
        ? [note('1', 100), note('2', 300), note('3', 200)]
        : []);

    render(<TestApp><Notes /></TestApp>);
    await settle();
    await settle();

    expect(screen.getByTestId('notes')).toHaveTextContent('2,3,1');
  });

  it('does not ask for notes in the same batch as the relay list', async () => {
    queryRelay.mockImplementation(async (_url, filters) => {
      if (filters[0].kinds?.includes(10002)) return [relaysOf('wss://alice-out/')];
      return [];
    });

    render(<TestApp><Notes /></TestApp>);
    await settle();

    expect(queryRelay.mock.calls.some(([, filters]) =>
      filters[0].kinds?.some((k) => FEED_KINDS.includes(k)))).toBe(false);
    expect(screen.getByTestId('notes')).toHaveTextContent('loading');
  });

  it('asks the author’s write relays once their list is known', async () => {
    queryRelay.mockImplementation(async (url, filters) => {
      if (filters[0].kinds?.includes(10002)) return [relaysOf('wss://alice-out/')];
      if (filters[0].kinds?.some((k) => FEED_KINDS.includes(k))) {
        return url === 'wss://alice-out/' ? [note('2', 300)] : [];
      }
      return [];
    });

    render(<TestApp><Notes /></TestApp>);
    await settle();
    await settle();

    expect(screen.getByTestId('notes')).toHaveTextContent('2');
    const noteCalls = queryRelay.mock.calls.filter(([, filters]) =>
      filters[0].kinds?.some((k) => FEED_KINDS.includes(k)));
    expect(noteCalls.some(([url]) => url === 'wss://alice-out/')).toBe(true);
    expect(noteCalls.every(([, filters]) => filters[0].authors?.includes(ALICE))).toBe(true);
  });
});
