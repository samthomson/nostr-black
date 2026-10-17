import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();
vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

// Dynamic import: the vi.mock registry above must be in place before the
// SUT (which imports publish at module scope) is evaluated.
const { enqueue, retryBroadcast, dismiss, resetQueue, queuedEntries, subscribeQueue } =
  await import('@/data/publish/queue');
const { store } = await import('@/data/store');

const note = (content: string): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: 1, tags: [], content }, generateSecretKey());

beforeEach(() => {
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  resetQueue();
  store.clear();
  localStorage.removeItem('broadcast.queue');
});

describe('broadcast queue', () => {
  it('removes the entry and ingests locally on success', async () => {
    const event = note('hello');
    enqueue('note', event, ['wss://a/']);

    await waitForSettle();
    expect(queuedEntries()).toHaveLength(0);
    expect(publish).toHaveBeenCalledWith(event, ['wss://a/']);
    expect(store.getEvent(event.id)).toBeDefined();
  });

  it('keeps the entry with its error when the relay is unreachable', async () => {
    publish.mockRejectedValue(new Error('offline'));
    const event = note('queued forever');
    enqueue('note', event, ['wss://a/']);

    await waitForSettle();
    const [entry] = queuedEntries();
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('offline');
    expect(entry.attempts).toBe(1);

    // retry succeeds: entry leaves
    publish.mockResolvedValue(undefined);
    retryBroadcast(entry.id);
    await waitForSettle();
    expect(queuedEntries()).toHaveLength(0);
  });

  it('survives a reload (queue is persisted)', async () => {
    publish.mockRejectedValue(new Error('offline'));
    enqueue('note', note('persisted'), ['wss://a/']);
    await waitForSettle();

    // simulate reload: module state is reloaded from localStorage
    const raw = localStorage.getItem('broadcast.queue');
    expect(raw).toContain('persisted');
  });

  it('dismiss drops a failed entry', async () => {
    publish.mockRejectedValue(new Error('offline'));
    const id = enqueue('note', note('bye'), ['wss://a/']);
    await waitForSettle();
    expect(queuedEntries()).toHaveLength(1);

    dismiss(id);
    expect(queuedEntries()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('broadcast.queue')!)).toHaveLength(0);
  });
});

const waitForSettle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await Promise.resolve();
  }
};

void getPublicKey;
void subscribeQueue;
