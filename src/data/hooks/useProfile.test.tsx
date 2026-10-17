import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { useProfile, useRelayList, useFollowList } = await import('./useProfile');
const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'a'.repeat(64);

const profileEvent = (name: string, over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: '1'.repeat(64),
  pubkey: ALICE,
  created_at: 1000,
  kind: 0,
  tags: [],
  content: JSON.stringify({ name }),
  sig: 'c'.repeat(128),
  ...over,
});

/** Profile lookups only — a profile batch also trails relay-list lookups. */
const kind0Calls = () =>
  queryRelay.mock.calls.filter(([, filters]) => filters[0].kinds?.includes(0));

const kind0Requests = () => kind0Calls().length;

const Name = ({ pubkey, label }: { pubkey: string; label: string }) => {
  const { metadata, pending } = useProfile(pubkey);
  return <div data-testid={label}>{pending ? 'loading' : (metadata?.name ?? 'none')}</div>;
};

/**
 * Let effects run so wants are declared, then send the batch that would
 * otherwise wait out the debounce, then let the result render.
 */
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

describe('useProfile', () => {
  it('fetches once however many components ask for the same pubkey', async () => {
    queryRelay.mockResolvedValue([profileEvent('alice')]);

    render(
      <TestApp>
        <Name pubkey={ALICE} label="a" />
        <Name pubkey={ALICE} label="b" />
        <Name pubkey={ALICE} label="c" />
      </TestApp>,
    );
    await settle();

    // The duplication this store exists to remove. Three consumers collapse
    // to one want, so each relay is asked exactly once for exactly Alice —
    // three independent fetches would have been three REQs per relay.
    const calls = kind0Calls();
    const relays = calls.map(([url]) => url);
    expect(new Set(relays).size).toBe(relays.length);
    expect(calls.every(([, filters]) => filters[0].authors?.length === 1)).toBe(true);

    for (const label of ['a', 'b', 'c']) {
      expect(screen.getByTestId(label)).toHaveTextContent('alice');
    }
  });

  it('serves a later component from the store without asking again', async () => {
    queryRelay.mockResolvedValue([profileEvent('alice')]);

    const view = render(
      <TestApp>
        <Name pubkey={ALICE} label="first" />
      </TestApp>,
    );
    await settle();
    const before = kind0Requests();

    // This is the profile-page bug: a second surface used to refetch under
    // its own cache key and render blank while it did.
    view.rerender(
      <TestApp>
        <Name pubkey={ALICE} label="first" />
        <Name pubkey={ALICE} label="second" />
      </TestApp>,
    );

    expect(screen.getByTestId('second')).toHaveTextContent('alice');
    await settle();
    expect(kind0Requests()).toBe(before);
  });

  it('is pending until a fetch finishes, then reports a genuine absence', async () => {
    let answer: (events: NostrEvent[]) => void = () => {};
    queryRelay.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    render(
      <TestApp>
        <Name pubkey={ALICE} label="a" />
      </TestApp>,
    );
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('a')).toHaveTextContent('loading');

    await act(async () => {
      const done = scheduler.flush();
      answer([]);
      await done;
    });

    // Asked, and nobody has a kind 0 for them — not the same as loading.
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('none'));
  });

  it('re-renders when a newer kind 0 supersedes the one on screen', async () => {
    queryRelay.mockResolvedValue([profileEvent('old')]);

    render(
      <TestApp>
        <Name pubkey={ALICE} label="a" />
      </TestApp>,
    );
    await settle();
    expect(screen.getByTestId('a')).toHaveTextContent('old');

    act(() => {
      store.ingest([profileEvent('new', { id: '2'.repeat(64), created_at: 2000 })], 'wss://x/');
    });

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('new'));
  });

  it('renders nothing rather than crashing on malformed metadata', async () => {
    queryRelay.mockResolvedValue([profileEvent('x', { content: 'not json' })]);

    render(
      <TestApp>
        <Name pubkey={ALICE} label="a" />
      </TestApp>,
    );
    await settle();

    expect(screen.getByTestId('a')).toHaveTextContent('none');
    // The event itself is still held — other uses of it stay valid.
    expect(store.getReplaceable(0, ALICE)).toBeDefined();
  });
});

const Relays = () => {
  const { list, pending } = useRelayList(ALICE);
  if (pending) return <div data-testid="relays">loading</div>;
  return <div data-testid="relays">{`r:${list.read.join()} w:${list.write.join()}`}</div>;
};

describe('useRelayList', () => {
  it('splits an author\'s NIP-65 markers into read and write', async () => {
    queryRelay.mockResolvedValue([{
      id: '3'.repeat(64),
      pubkey: ALICE,
      created_at: 1000,
      kind: 10002,
      tags: [
        ['r', 'wss://both/'],
        ['r', 'wss://in/', 'read'],
        ['r', 'wss://out/', 'write'],
      ],
      content: '',
      sig: 'c'.repeat(128),
    }]);

    render(<TestApp><Relays /></TestApp>);
    await settle();

    expect(screen.getByTestId('relays')).toHaveTextContent(
      'r:wss://both/,wss://in/ w:wss://both/,wss://out/',
    );
  });
});

const Following = () => {
  const { count, pending } = useFollowList(ALICE);
  if (pending) return <div data-testid="following">loading</div>;
  return <div data-testid="following">{count}</div>;
};

describe('useFollowList', () => {
  it('counts p tags on the author kind 3', async () => {
    queryRelay.mockResolvedValue([{
      id: '4'.repeat(64),
      pubkey: ALICE,
      created_at: 1000,
      kind: 3,
      tags: [['p', 'b'.repeat(64)], ['p', 'c'.repeat(64)], ['e', '1'.repeat(64)]],
      content: '',
      sig: 'c'.repeat(128),
    }]);

    render(<TestApp><Following /></TestApp>);
    await settle();

    expect(screen.getByTestId('following')).toHaveTextContent('2');
  });
});
