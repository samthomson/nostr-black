import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import * as RelayClient from '@/net/relayClient';

import Index from './Index';
import { TestApp } from '@/test/TestApp';

const USER = 'u'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const event = (kind: number, pubkey: string, content: string, tags: string[][] = [], createdAt = 1700000000): NostrEvent => ({
  id: `${pubkey.slice(0, 55)}${kind % 10}${String(createdAt % 100000000).padStart(8, '0')}`,
  pubkey,
  created_at: createdAt,
  kind,
  tags,
  content,
  sig: 'f'.repeat(128),
});

let mockUser: { pubkey: string } | undefined = undefined;
/** When defined, the user follows these pubkeys. */
let follows: string[] = [];
/** kind 3 result: `[]` = no events found; non-empty = use these events. */
let kind3Result: NostrEvent[] = [];
/** Notes served per relay url for feed queries. */
let notesByRelay: Record<string, NostrEvent[]> = {};
/** When true, NostrSync's discovery attempt has settled. */
let discoverySettled = false;

const relayCalls: { url: string; filters: NostrFilter[] }[] = [];

vi.mock('@/net/relayClient', () => ({
  queryRelay: vi.fn(async (url: string, filters: NostrFilter[]) => {
    relayCalls.push({ url, filters });
    const kinds = filters[0].kinds ?? [];
    if (kinds.includes(3)) {
      return kind3Result.length ? kind3Result : follows.length
        ? [event(3, USER, '', follows.map((p) => ['p', p]))]
        : [];
    }
    if (kinds.includes(10002)) {
      return [
        event(10002, A, '', [['r', 'wss://one.example']], 1700000600),
        event(10002, B, '', [['r', 'wss://two.example']], 1700000600),
      ].filter((e) => (filters[0].authors ?? []).includes(e.pubkey));
    }
    return notesByRelay[url] ?? [];
  }),
  queryRelays: vi.fn(async (urls: string[], filters: NostrFilter[]) => {
    const kinds = filters[0].kinds ?? [];
    const authors = filters[0].authors ?? [];
    // NostrSync's discovery query for the user's own 10002: mark settled.
    if (kinds.includes(10002) && authors.includes(USER)) {
      discoverySettled = true;
      return [];
    }
    // Stage 2: authors' 10002 relay lists.
    if (kinds.includes(10002)) {
      return [
        event(10002, A, '', [['r', 'wss://one.example']], 1700000600),
        event(10002, B, '', [['r', 'wss://two.example']], 1700000600),
      ].filter((e) => authors.includes(e.pubkey));
    }
    const results = await Promise.all(
      urls.map(async (url) => {
        relayCalls.push({ url, filters });
        if (kinds.includes(3)) {
          return kind3Result.length ? kind3Result : follows.length
            ? [event(3, USER, '', follows.map((p) => ['p', p]))]
            : [];
        }
        return [];
      }),
    );
    return results.flat();
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser }),
}));

// NostrSync marks discovery settled via AppContext; surface that through the
// mocked relay layer by re-rendering reality: the tests below assert verdicts
// only after the settle marker, which NostrSync writes when its queryRelays
// call resolves (mocked above).

beforeEach(() => {
  vi.mocked(RelayClient.queryRelay).mockClear();
  relayCalls.length = 0;
  mockUser = undefined;
  follows = [];
  kind3Result = [];
  notesByRelay = {};
  discoverySettled = false;
  window.localStorage.clear();
});

describe('Index logged out', () => {
  it('shows the brand page and never queries relays', async () => {
    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText('nostr.black')).toBeTruthy();
    expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
    expect(relayCalls).toHaveLength(0);
  });
});

describe('Index outbox feed (logged in)', () => {
  beforeEach(() => {
    mockUser = { pubkey: USER };
  });

  it('queries notes only on the relays each followed author declared', async () => {
    const JUNK = 'z'.repeat(64);
    follows = [A, B];
    notesByRelay = {
      'wss://one.example': [
        event(1, A, 'note from a', [], 1700000900),
        // a buggy or hostile relay serving someone we don't follow
        event(1, JUNK, 'unrequested junk', [], 1700000901),
      ],
      'wss://two.example': [event(1, B, 'note from b', [], 1700000600)],
    };

    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    let ok = true;
    try { await screen.findByText('note from a', {}, { timeout: 3000 }); } catch { ok = false; }
    if (!ok) {
      const fs2 = await import('node:fs');
      fs2.writeFileSync('/tmp/dbg-h.txt', document.body.textContent ?? 'EMPTY');
      throw new Error('dumped');
    }
    expect(screen.getByText('note from b')).toBeTruthy();
    expect(screen.queryByText('unrequested junk')).toBeNull();

    // Feed queries went only to the declared relays, with author filters.
    const feedCalls = relayCalls.filter((c) => (c.filters[0].kinds ?? []).includes(1));
    expect(feedCalls.map((c) => c.url).sort()).toEqual([
      'wss://one.example',
      'wss://two.example',
    ]);
    const authors = feedCalls.flatMap((c) => c.filters[0].authors ?? []);
    expect(authors).toContain(A);
    expect(authors).toContain(B);
    // The firehose shape (a feed query without authors) must never be sent.
    expect(feedCalls.every((c) => (c.filters[0].authors ?? []).length > 0)).toBe(true);
    expect(discoverySettled).toBe(true);
  });

  it('shows the not-following state for an empty contact list, without querying notes', async () => {
    kind3Result = [event(3, USER, '', [])];

    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText(/not following anyone yet/i, {}, { timeout: 3000 })).toBeTruthy();
    expect(relayCalls.filter((c) => (c.filters[0].kinds ?? []).includes(1))).toHaveLength(0);
  });

  it('shows follow-list-not-found when no kind 3 exists, and never claims zero follows', async () => {
    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText(/couldn't find your follow list/i, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/not following anyone yet/i)).toBeNull();
    expect(relayCalls.filter((c) => (c.filters[0].kinds ?? []).includes(1))).toHaveLength(0);
  });
});
