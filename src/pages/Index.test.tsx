import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type * as NostrReact from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import Index from './Index';
import { TestApp } from '@/test/TestApp';

const note = (id: string, pubkey: string, createdAt: number, content: string): NostrEvent => ({
  id,
  pubkey,
  created_at: createdAt,
  kind: 1,
  tags: [],
  content,
  sig: 'sig',
});

let feedEvents: NostrEvent[] = [];
let mockUser: { pubkey: string } | undefined = undefined;

/** Feed events for kind-1 queries; nothing for any other query (authors etc). */
const mockQuery = vi.fn(async (filters: NostrFilter[]) =>
  filters.some((f) => f.kinds?.includes(1)) ? feedEvents : [],
);

vi.mock('@nostrify/react', async (importOriginal) => {
  const actual = await importOriginal<typeof NostrReact>();
  return {
    ...actual,
    useNostr: () => ({ nostr: { query: mockQuery } }),
  };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser }),
}));

beforeEach(() => {
  mockQuery.mockClear();
  feedEvents = [
    note('a'.repeat(64), 'aaa'.repeat(10).slice(0, 64), 1700000000, 'first note'),
    // duplicate of the second event, as pools can return it twice
    note('b'.repeat(64), 'bbb'.repeat(10).slice(0, 64), 1700000600, 'second note'),
    note('b'.repeat(64), 'bbb'.repeat(10).slice(0, 64), 1700000600, 'second note'),
  ];
  mockUser = undefined;
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
    expect(screen.getByText(/private by default — public is the exception/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
    expect(screen.queryByText('second note')).toBeNull();

    // No feed query may fire while logged out.
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Index feed (logged in)', () => {
  beforeEach(() => {
    mockUser = { pubkey: 'a'.repeat(64) };
  });

  it('renders notes newest-first, deduplicated by event id', async () => {
    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText('second note')).toBeTruthy();
    expect(screen.getByText('first note')).toBeTruthy();

    const contents = screen.getAllByText(/note$/).map((el) => el.textContent);
    expect(contents).toHaveLength(2);
    // 1700000600 (second) sorts above 1700000000 (first)
    expect(contents.indexOf('second note')).toBeLessThan(contents.indexOf('first note'));
  });

  it('shows the empty state when no events come back', async () => {
    feedEvents = [];

    render(
      <TestApp>
        <Index />
      </TestApp>,
    );

    expect(await screen.findByText(/No notes found/i)).toBeTruthy();
  });
});
