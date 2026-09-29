import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { store } from '@/data/store';
import { scheduler } from '@/data/scheduler';
import { clearFeeds } from '@/data/feed/registry';
import { createPersister } from '@/data/persist/persist';
import { closeDatabase, deleteDatabase } from '@/data/persist/db';
import { resetUseIsTor } from '@/hooks/useEgress';

import Index from './Index';
import { TestApp } from '@/test/TestApp';

const USER = 'u'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const event = (
  kind: number,
  pubkey: string,
  content: string,
  tags: string[][] = [],
  createdAt = 1700000000,
): NostrEvent => ({
  id: `${pubkey.slice(0, 55)}${kind % 10}${String(createdAt % 100000000).padStart(8, '0')}`,
  pubkey,
  created_at: createdAt,
  kind,
  tags,
  content,
  sig: 'f'.repeat(128),
});

let mockUser: { pubkey: string } | undefined = undefined;
/** Notes served per relay url for feed queries. */
let notesByRelay: Record<string, NostrEvent[]> = {};
/** Per-author kind 10002: pubkey → declared relay urls. */
let authorRelays: Record<string, string[]> = {};
/** When true, NostrSync's discovery attempt has settled. */
let discoverySettled = false;
/** When set, feed queries wait on this — proves the screen came from disk. */
let holdFeed: Promise<void> | undefined;
let releaseFeed: (() => void) | undefined;

const relayCalls: { url: string; filters: NostrFilter[] }[] = [];

const serve = (url: string, filters: NostrFilter[]): NostrEvent[] => {
  relayCalls.push({ url, filters });
  const kinds = filters[0].kinds ?? [];
  const authors = filters[0].authors ?? [];

  if (kinds.includes(10002)) {
    if (authors.includes(USER)) discoverySettled = true;
    return Object.entries(authorRelays)
      .filter(([pubkey]) => authors.includes(pubkey))
      .map(([pubkey, urls]) =>
        event(10002, pubkey, '', urls.map((u) => ['r', u]), 1700000600));
  }
  if (kinds.includes(0) || kinds.includes(3)) return [];

  // Deliberately unfiltered: a relay is free to serve whatever it likes,
  // and the client must not trust it.
  return notesByRelay[url] ?? [];
};

vi.mock('@/net/net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/net/net')>();
  return {
    ...actual,
    isTor: async () => true,
    queryRelayResult: vi.fn(async (url: string, filters: NostrFilter[]) => {
      if (holdFeed) await holdFeed;
      return { url, events: serve(url, filters), eose: true };
    }),
    queryRelay: vi.fn(async (url: string, filters: NostrFilter[]) => serve(url, filters)),
    queryRelays: vi.fn(async (urls: string[], filters: NostrFilter[]) => {
      const kinds = filters[0].kinds ?? [];
      const authors = filters[0].authors ?? [];
      // NostrSync's discovery query for the user's own 10002.
      if (kinds.includes(10002) && authors.includes(USER)) {
        discoverySettled = true;
        return [];
      }
      return urls.flatMap((url) => serve(url, filters));
    }),
  };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser, users: mockUser ? [mockUser] : [] }),
}));

beforeEach(() => {
  relayCalls.length = 0;
  mockUser = undefined;
  notesByRelay = {};
  authorRelays = {};
  discoverySettled = false;
  releaseFeed?.();
  releaseFeed = undefined;
  holdFeed = undefined;
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetUseIsTor();
  store.clear();
  scheduler.reset();
  clearFeeds();
});

afterEach(() => {
  releaseFeed?.();
  releaseFeed = undefined;
  holdFeed = undefined;
  clearFeeds();
});

const feedCalls = () =>
  relayCalls.filter((c) => {
    const filter = c.filters[0];
    // Notes also travel as engagement/thread `#e` filters; those are not a feed.
    return (filter.kinds ?? []).includes(1) && !filter['#e'] && !filter.ids;
  });

describe('Index logged out', () => {
  it('shows the brand page and never queries relays', async () => {
    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    // The brand renders redacted: real text 'nostr black', visually hidden.
    expect(await screen.findByText('nostr')).toBeTruthy();
    expect(await screen.findByText('black')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy();
    expect(relayCalls).toHaveLength(0);
  });
});

describe('Index outbox feed (logged in)', () => {
  beforeEach(() => {
    mockUser = { pubkey: USER };
    authorRelays = { [A]: ['wss://one.example'], [B]: ['wss://two.example'] };
  });

  it('queries notes only on the relays each followed author declared', async () => {
    const JUNK = 'z'.repeat(64);
    notesByRelay = {
      'wss://one.example': [
        event(1, A, 'note from a', [], 1700000900),
        // a buggy or hostile relay serving someone we don't follow
        event(1, JUNK, 'unrequested junk', [], 1700000901),
      ],
      'wss://two.example': [event(1, B, 'note from b', [], 1700000600)],
    };

    render(
      <TestApp userState={{ follows: { pubkeys: [A, B], updatedAt: 1 } }}>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText('note from a', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('note from b')).toBeTruthy();
    expect(screen.queryByText('unrequested junk')).toBeNull();

    expect([...new Set(feedCalls().map((c) => c.url))].sort()).toEqual([
      'wss://one.example',
      'wss://two.example',
    ]);
    // The firehose shape (a feed query without authors) must never be sent.
    expect(feedCalls().every((c) => (c.filters[0].authors ?? []).length > 0)).toBe(true);
    expect(discoverySettled).toBe(true);
  });

  it('shows every relay a note was found on, not just one', async () => {
    authorRelays = { [A]: ['wss://one.example', 'wss://two.example'] };
    const note = event(1, A, 'multi-relay note', [], 1700000700);
    notesByRelay = {
      'wss://one.example': [note],
      'wss://two.example': [note],
    };

    render(
      <TestApp userState={{ follows: { pubkeys: [A], updatedAt: 1 } }}>
        <Index />
      </TestApp>,
    );

    await screen.findByText('multi-relay note', {}, { timeout: 3000 });
    // A declares both relays, so the note is queried on both — and both
    // must appear as provenance pills.
    expect(await screen.findByText('one.example')).toBeTruthy();
    expect(await screen.findByText('two.example')).toBeTruthy();
  });

  it('shows the not-following state for an empty contact list, without querying notes', async () => {
    render(
      <TestApp userState={{ follows: { pubkeys: [], updatedAt: 1 } }}>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText(/not following anyone yet/i, {}, { timeout: 3000 })).toBeTruthy();
    expect(feedCalls()).toHaveLength(0);
  });

  it('renders cached notes on cold start without waiting for a feed query', async () => {
    holdFeed = new Promise((resolve) => {
      releaseFeed = resolve;
    });

    await deleteDatabase();
    const cached = event(1, A, 'cached note', [], 1700000800);
    const writer = createPersister(store, { flushMs: 60_000 });
    await writer.start();
    store.ingest([
      event(10002, A, '', [['r', 'wss://one.example']], 1700000600),
      cached,
    ], 'wss://one.example');
    await writer.flush();
    await writer.stop();
    await closeDatabase();
    store.clear();

    render(
      <TestApp userState={{ follows: { pubkeys: [A], updatedAt: 1 } }}>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText('cached note', {}, { timeout: 3000 })).toBeTruthy();
    expect(feedCalls()).toHaveLength(0);
  });

  it('shows follow-list-not-found when no kind 3 exists, and never claims zero follows', async () => {
    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText(/couldn't find your follow list/i, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/not following anyone yet/i)).toBeNull();
    expect(feedCalls()).toHaveLength(0);
  });
});
