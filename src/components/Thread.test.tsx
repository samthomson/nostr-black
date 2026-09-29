import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { Thread } from '@/components/Thread';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const { scheduler } = await import('@/data/scheduler');
const { store } = await import('@/data/store');

const ALICE = 'a'.repeat(64);
const PARENT = '1'.repeat(64);
const CHILD = '2'.repeat(64);
const GRAND = '3'.repeat(64);

const note = (over: Partial<NostrEvent>): NostrEvent => ({
  id: '0'.repeat(64),
  pubkey: ALICE,
  created_at: 1000,
  kind: 1,
  tags: [],
  content: '',
  sig: 's'.repeat(128),
  ...over,
});

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

describe('Thread', () => {
  it('expands one more hop only after a click', async () => {
    store.ingest([
      note({ id: PARENT, content: 'root' }),
      note({ id: CHILD, content: 'child', tags: [['e', PARENT, '', 'reply']], created_at: 1100 }),
      note({ id: GRAND, content: 'grand', tags: [['e', CHILD, '', 'reply']], created_at: 1200 }),
    ], 'wss://found/');

    queryRelay.mockImplementation(async (_url, filters) => {
      const ids = filters[0]['#e'] ?? [];
      if (ids.includes(PARENT)) {
        return [note({ id: CHILD, content: 'child', tags: [['e', PARENT, '', 'reply']], created_at: 1100 })];
      }
      if (ids.includes(CHILD)) {
        return [note({ id: GRAND, content: 'grand', tags: [['e', CHILD, '', 'reply']], created_at: 1200 })];
      }
      return [];
    });

    render(
      <TestApp>
        <Thread parent={PARENT} author={ALICE} />
      </TestApp>,
    );
    await settle();

    expect(screen.getByText('child')).toBeTruthy();
    expect(screen.queryByText('grand')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'replies' }));
    await settle();

    expect(screen.getByText('grand')).toBeTruthy();
  });
});
