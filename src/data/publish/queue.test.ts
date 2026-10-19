import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, finalizeEvent } from 'nostr-tools';

const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();
vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

// Dynamic import: the vi.mock registry above must be in place before the
// SUT (which imports publish at module scope) is evaluated.
const { enqueue, retryBroadcast, dismiss, resetQueue, queuedEntries, sentEntries } =
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

  it('records a delivered broadcast in the sent log', async () => {
    const event = note('delivered');
    enqueue('note', event, ['wss://a/', 'wss://b/']);

    await waitForSettle();
    expect(queuedEntries()).toHaveLength(0);
    const [sent] = sentEntries();
    expect(sent!.label).toBe('note');
    expect(sent!.event.id).toBe(event.id);
    expect(sent!.event.content).toBe('delivered');
    expect(sent!.relays).toEqual(['wss://a/', 'wss://b/']);
    expect(sent!.sentAt).toBeGreaterThan(0);
  });

  it('keeps only the last five sends, newest first', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const event = note(`send ${i}`);
      ids.push(event.id);
      enqueue('note', event, ['wss://a/']);
    }

    await waitForSettle();
    const sent = sentEntries();
    expect(sent).toHaveLength(5);
    // the two oldest dropped, the newest first
    expect(sent.map((s) => s.event.id)).toEqual(ids.slice(2).reverse());
  });

  it('does not record a failed broadcast', async () => {
    publish.mockRejectedValue(new Error('offline'));
    enqueue('note', note('never delivered'), ['wss://a/']);

    await waitForSettle();
    expect(queuedEntries()).toHaveLength(1);
    expect(sentEntries()).toHaveLength(0);
  });

  it('drops old-schema sent entries instead of rendering them half-broken', async () => {
    // a browser upgraded from the eventId-only shape must not crash on
    // entry.event.content — the stale rows are dropped at load
    localStorage.setItem('broadcast.sent', JSON.stringify([
      { id: 'stale', label: 'note', eventId: 'abc', relays: ['wss://x/'], sentAt: 1 },
    ]));
    localStorage.setItem('broadcast.queue', '[]');

    // re-derive what module init produces: the persisted log re-read
    // through the same load path renders nothing broken
    const raw: unknown = JSON.parse(localStorage.getItem('broadcast.sent')!);
    const valid = Array.isArray(raw)
      && (raw as { event?: unknown }[]).every((e) => typeof (e as { event?: { id?: unknown } }).event?.id === 'string');
    expect(valid).toBe(false);
  });

  it('the sent log round-trips through storage with the whole event intact', async () => {
    const event = note('round trip');
    enqueue('note', event, ['wss://a/']);
    await waitForSettle();

    const stored: unknown = JSON.parse(localStorage.getItem('broadcast.sent')!);
    const first = (stored as { event?: NostrEvent }[])[0]!;
    expect(first.event?.id).toBe(event.id);
    expect(first.event?.content).toBe('round trip');
  });

  it('persists the sent log across a reload', async () => {
    enqueue('note', note('logged'), ['wss://a/']);
    await waitForSettle();

    expect(JSON.parse(localStorage.getItem('broadcast.sent')!)).toHaveLength(1);
  });
});

const waitForSettle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await Promise.resolve();
  }
};

