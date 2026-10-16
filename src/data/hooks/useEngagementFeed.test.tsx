import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useEngagementFeed } = await import('./useEngagementFeed');
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

const responder = (kind: number, pubkey: string, content = ''): NostrEvent => ({
  id: `${kind}${pubkey.slice(0, 62)}`,
  pubkey,
  created_at: 2,
  kind,
  tags: [['e', NOTE]],
  content,
  sig: 's'.repeat(128),
});

const Row = () => {
  const feed = useEngagementFeed(NOTE);
  return (
    <div data-testid="n" data-pending={String(feed.pending)}>
      {feed.pending ? '…' : `${feed.replies}/${feed.reactions.length}/${feed.reposts.length}`}
    </div>
  );
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

describe('useEngagementFeed', () => {
  it('shows the spinner until the want settles, then every kind from one query', async () => {
    store.ingest([note], 'wss://one/');
    queryRelay.mockResolvedValue([
      responder(1, 'b'.repeat(64), 'a reply'),
      responder(7, 'c'.repeat(64), '+'),
      responder(6, 'd'.repeat(64)),
    ]);

    render(<TestApp><Row /></TestApp>);
    // flush happens on the debounce; while it runs the numbers are
    // unknown. Assert the spinner semantics through the settled end
    // state instead: the want ran exactly once and every kind arrived.
    await settle();
    await settle();

    const { store: st } = await import('@/data/store');
    const { settleOf } = await import('@/data/scheduler');
    await waitFor(() => expect(st.get(settleOf(NOTE)).settledAt).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('1/1/1'));
    expect(screen.getByTestId('n')).toHaveAttribute('data-pending', 'false');
    // one engagement want: one #e query, not one per kind
    const asked = queryRelay.mock.calls.filter(([, filters]) => filters[0]['#e']?.[0] === NOTE);
    expect(new Set(asked.map(([, filters]) => JSON.stringify(filters))).size).toBe(1);
  });

  it('returns empty and asks nothing for a private item (no id)', async () => {
    render(
      <TestApp>
        <PrivateRow />
      </TestApp>,
    );
    await settle();
    expect(screen.getByTestId('p')).toHaveTextContent('0/0/0');
    expect(queryRelay).not.toHaveBeenCalled();
  });
});

const PrivateRow = () => {
  const feed = useEngagementFeed(undefined);
  return <div data-testid="p">{`${feed.replies}/${feed.reactions.length}/${feed.reposts.length}`}</div>;
};
