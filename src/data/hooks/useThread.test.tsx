import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useThread } = await import('./useThread');
const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'a'.repeat(64);
const PARENT = 'p'.repeat(64);
const CHILD = 'c'.repeat(64);
const DEEP = 'd'.repeat(64);

const note = (over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: over.id ?? PARENT,
  pubkey: ALICE,
  created_at: over.created_at ?? 1000,
  kind: over.kind ?? 1,
  tags: over.tags ?? [],
  content: '',
  sig: 's'.repeat(128),
  ...over,
});

const Children = ({ parent }: { parent: string }) => {
  const { children, pending } = useThread(parent, ALICE);
  if (pending && children.length === 0) return <div data-testid="thread">loading</div>;
  return <div data-testid="thread">{children.map((e) => e.id.slice(0, 1)).join(',')}</div>;
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

describe('useThread', () => {
  it('shows only direct children after the thread want settles', async () => {
    store.ingest([note()], 'wss://found/');
    queryRelay.mockResolvedValue([
      note({
        id: CHILD,
        created_at: 1100,
        tags: [['e', PARENT, '', 'reply']],
      }),
      note({
        id: DEEP,
        kind: 1111,
        created_at: 1200,
        tags: [['E', PARENT], ['e', CHILD]],
      }),
    ]);

    render(<TestApp><Children parent={PARENT} /></TestApp>);
    await settle();

    expect(screen.getByTestId('thread')).toHaveTextContent('c');
    expect(screen.getByTestId('thread')).not.toHaveTextContent('d');
  });

  it('is pending until the fetch finishes, then empty is a verdict', async () => {
    store.ingest([note()], 'wss://found/');
    let answer: (events: NostrEvent[]) => void = () => {};
    queryRelay.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    render(<TestApp><Children parent={PARENT} /></TestApp>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('thread')).toHaveTextContent('loading');

    await act(async () => {
      const done = scheduler.flush();
      answer([]);
      await done;
    });

    await waitFor(() => expect(screen.getByTestId('thread')).toHaveTextContent(''));
  });
});
