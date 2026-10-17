import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { Shell } from '@/components/Shell';
import { Note } from '@/components/Note';
import { ColumnsProvider } from '@/components/columns/ColumnsContext';
import { useColumns, type ColumnPointer } from '@/components/columns/columnsState';
import { useKeystore } from '@/auth/useKeystore';
import { store } from '@/data/store';
import { makeRumor, type Rumor } from '@/lib/feedEncryption';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

const sk = generateSecretKey();

beforeAll(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

const note = (content: string, at: number): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: at, tags: [], content }, sk);

/** A root note and a reply hanging off it. */
const ROOT = note('the root note', 100);
const REPLY = finalizeEvent(
  { kind: 1, created_at: 200, tags: [['e', ROOT.id, '', 'root']], content: 'the reply' },
  sk,
);

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

beforeEach(() => {
  store.clear();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  store.ingest([ROOT, REPLY], 'wss://r/');
});

const panes = () => screen.getAllByLabelText('note column') as HTMLElement[];

describe('columns', () => {
  it('clicking a note opens a pane beside the feed — no navigation', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <Note event={ROOT} />
          </Shell>
        </Unlock>
      </TestApp>,
    );

    await user.click((await screen.findByText('the root note')).parentElement!);
    expect(await screen.findAllByLabelText('note column')).toHaveLength(1);

    // The pane is the replies — the root note is NOT repeated (it stays
    // in the feed, anchored and lit); its reply renders in the pane.
    const pane = within(panes()[0]);
    expect(await pane.findByText('the reply')).toBeTruthy();
    expect(pane.queryByText('the root note')).toBeNull();
    expect(screen.getByText('the root note')).toBeTruthy();
  });

  it('clicking a reply opens a second pane; closing collapses back', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <Note event={ROOT} />
          </Shell>
        </Unlock>
      </TestApp>,
    );

    await user.click((await screen.findByText('the root note')).parentElement!);
    await user.click(within(panes()[0]).getByText('the reply'));
    await waitFor(() => expect(panes()).toHaveLength(2));

    // Closing the second pane via its own close button leaves the first.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(panes()).toHaveLength(1));
    expect(within(panes()[0]).getByText('the reply')).toBeTruthy();
  });

  it('two panes open: the dimmed first pane is frozen, modal-capable, and its ground click closes only the right', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <Note event={ROOT} />
          </Shell>
        </Unlock>
      </TestApp>,
    );

    await user.click((await screen.findByText('the root note')).parentElement!);
    await user.click(within(panes()[0]).getByText('the reply'));
    await waitFor(() => expect(panes()).toHaveLength(2));

    // Backdrop contract, pane edition: the dimmed pane cannot scroll.
    const dimmedScroller = panes()[0].firstElementChild as HTMLElement;
    expect(dimmedScroller.className).toContain('overflow-y-hidden');
    // ...but its controls still work: the info button opens its dialog.
    await user.click(within(panes()[0]).getByRole('button', { name: 'event info' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // A click on the dimmed pane's empty ground closes everything to its
    // right — the second pane — and nothing else.
    await user.click(dimmedScroller);
    await waitFor(() => expect(panes()).toHaveLength(1));
    expect(within(panes()[0]).getByText('the reply')).toBeTruthy();
  });

  it('the feed freezes while panes are open: list held, controls gone, thawed on close', async () => {
    const user = userEvent.setup();
    feedNotes.notes = [ROOT];
    const { Feed } = await import('@/components/Feed');
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <Feed />
          </Shell>
        </Unlock>
      </TestApp>,
    );

    // Click the note body — the real open affordance.
    await user.click(await screen.findByText('the root note'));
    await waitFor(() => expect(panes()).toHaveLength(1));

    // Frozen: the scroller is inert and the growth controls are gone.
    const main = document.querySelector('main') as HTMLElement;
    expect(main.className).toContain('overflow-y-hidden');
    expect(screen.queryByRole('button', { name: 'load older notes' })).toBeNull();

    // New data landing while frozen does NOT splice into the backdrop.
    feedNotes.notes = [note('a later note', 300), ROOT];
    await waitFor(() => expect(screen.queryByText('a later note')).toBeNull());

    // Close: the thaw shows live data again.
    await user.click(main);
    await waitFor(() => expect(screen.getByText('a later note')).toBeTruthy());
  });

  it('the main column never unmounts — its scroll survives pane open/close', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <div style={{ height: '3000px' }}>
              <Note event={ROOT} />
            </div>
          </Shell>
        </Unlock>
      </TestApp>,
    );

    const main = document.querySelector('main') as HTMLElement;
    main.scrollTop = 777;

    await user.click((await screen.findByText('the root note')).parentElement!);
    await screen.findAllByLabelText('note column');
    await user.click(main); // the dimmed feed column is the back button
    await waitFor(() => expect(screen.queryByLabelText('note column')).toBeNull());

    // No scroll restoration code exists because none is needed: the same
    // element, the same position.
    expect(main.scrollTop).toBe(777);
  });
});

// Hoisted state the module mocks read from — the private test fills it
// Hoisted feed state the useFeed mock reads — the freeze test mutates it.
const feedNotes = vi.hoisted(() => ({
  notes: [] as NostrEvent[],
}));
vi.mock('@/data/hooks/useFeed', () => ({
  useFeed: () => ({
    notes: feedNotes.notes,
    pending: [],
    loading: false,
    exhausted: false,
    isLoading: false,
    noFollows: false,
    followsNotFound: false,
    loadMore: () => {},
    acceptPending: () => {},
  }),
}));

const priv = vi.hoisted(() => ({
  posts: [] as unknown[],
  pending: false,
}));
const privActions = vi.hoisted(() => ({
  reply: () => {}, react: () => {}, editReply: () => {}, remove: () => {},
}));
vi.mock('@/data/hooks/usePrivateFeed', () => ({
  usePrivateFeed: () => ({ posts: priv.posts, pending: priv.pending, connectedPeers: [] }),
}));
vi.mock('@/hooks/usePrivateActions', () => ({ usePrivateActions: () => privActions }));
vi.mock('@/components/PrivateNote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/PrivateNote')>()),
  PrivateItem: ({ rumor, onOpen }: { rumor: Rumor; onOpen?: () => void }) => (
    <div onClick={onOpen}>{rumor.content}</div>
  ),
}));

describe('private notes open panes too — same shell, conversation data', () => {
  it('a sealed note opens a pane of its conversation replies; replies iterate', async () => {
    const user = userEvent.setup();
    const seal = (content: string, at: number) =>
      finalizeEvent({ kind: 1059, created_at: at, tags: [], content }, sk);
    const rootRumor = makeRumor(getPublicKey(sk), 'sealed root words', []).rumor;
    const replyRumor = makeRumor(getPublicKey(sk), 'sealed reply words', [['e', rootRumor.id]]).rumor;
    priv.posts = [{
      note: { rumor: rootRumor, wrapper: seal('x', 1), replyCek: new Uint8Array(32) },
      history: [],
      replies: [{ rumor: replyRumor, wrapper: seal('y', 2) }],
      conversation: { replies: new Map(), reactions: [], root: null },
    }];

    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <Shell>
            <Note event={rootRumor} wrapper={seal('w', 0)} />
          </Shell>
        </Unlock>
      </TestApp>,
    );

    await user.click((await screen.findByText('sealed root words')).parentElement!);
    const pane = within((await screen.findAllByLabelText('note column'))[0]);
    // Replies only — the sealed root is not repeated in the pane.
    expect(await pane.findByText('sealed reply words')).toBeTruthy();
    expect(pane.queryByText('sealed root words')).toBeNull();

    // Iterating: the reply opens a second, deeper private pane.
    await user.click(pane.getByText('sealed reply words'));
    await waitFor(() => expect(panes()).toHaveLength(2));
  });
});

/** Exposes the live stack and open() to the test. */
const StackProbe = ({
  onReady,
  onStack,
}: {
  onReady: (open: (p: ColumnPointer, depth?: number) => void) => void;
  onStack: (columns: readonly ColumnPointer[]) => void;
}) => {
  const stack = useColumns();
  if (stack) onReady(stack.open);
  onStack(stack?.columns ?? []);
  return null;
};

describe('column stack semantics', () => {
  it('replaces the chain below the clicked depth and collapses repeats', async () => {
    const root: ColumnPointer = { id: 'a'.repeat(64) };
    const mid: ColumnPointer = { id: 'b'.repeat(64) };
    const leaf: ColumnPointer = { id: 'c'.repeat(64) };
    const branch: ColumnPointer = { id: 'd'.repeat(64) };
    const ids = () => stack.map((c) => c.id);
    let stack: readonly ColumnPointer[] = [];
    let open: ((p: ColumnPointer, depth?: number) => void) | undefined;

    render(
      <TestApp>
        <ColumnsProvider>
          <StackProbe
            onReady={(o) => { open = o; }}
            onStack={(next) => { stack = next; }}
          />
        </ColumnsProvider>
      </TestApp>,
    );

    await waitFor(() => expect(open).toBeTruthy());
    open!(root);      // from the feed
    open!(mid, 0);    // a reply clicked in pane 0
    open!(leaf, 1);   // a reply clicked in pane 1
    await waitFor(() => expect(ids()).toEqual([root.id, mid.id, leaf.id]));

    open!(mid, 0);    // walked back up: collapse the chain to mid
    await waitFor(() => expect(ids()).toEqual([root.id, mid.id]));

    open!(branch, 0); // a new pane-1 replaces mid: it was clicked in pane 0
    await waitFor(() => expect(ids()).toEqual([root.id, branch.id]));
  });
});
