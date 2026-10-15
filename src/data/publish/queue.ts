import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { store } from '@/data/store';
import { refreshFeeds } from '@/data/feed/registry';

/**
 * The broadcast queue: every outgoing event passes through here.
 *
 * A broadcast that fails (offline, relay refusal) stays queued with its
 * error; success removes it. The queue survives reloads — an unsent note
 * must never be lost to a refresh. Entries hold already-signed events:
 * signing happens at compose time, the queue only transports bytes.
 */

export interface BroadcastEntry {
  id: string;
  /** What the user would call it: 'note', 'private note (1 of 2)'… */
  label: string;
  event: NostrEvent;
  relays: string[];
  createdAt: number;
  status: 'queued' | 'failed';
  attempts: number;
  error?: string;
}

const STORAGE_KEY = 'broadcast.queue';
const listeners = new Set<() => void>();
const inflight = new Set<string>();

const load = (): BroadcastEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BroadcastEntry[]) : [];
  } catch {
    return [];
  }
};

let entries: BroadcastEntry[] = load();

const persist = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable: queue lives for this session only.
  }
};

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

const snapshot = (): BroadcastEntry[] => entries;

const remove = (id: string): void => {
  entries = entries.filter((entry) => entry.id !== id);
  persist();
  notify();
};

/** One broadcast attempt. Success removes the entry and ingests locally;
 * failure keeps it with the error, ready to retry. */
const attempt = async (id: string): Promise<void> => {
  const entry = entries.find((e) => e.id === id);
  if (!entry || inflight.has(id)) return;
  inflight.add(id);
  try {
    await publish(entry.event, entry.relays);
    store.ingest([entry.event], entry.relays[0] ?? '');
    refreshFeeds();
    remove(id);
  } catch (error) {
    entries = entries.map((e) =>
      e.id === id
        ? { ...e, status: 'failed' as const, attempts: e.attempts + 1, error: error instanceof Error ? error.message : String(error) }
        : e,
    );
    persist();
    notify();
  } finally {
    inflight.delete(id);
  }
};

/** Queue a signed event for broadcast. Fires the first attempt
 * immediately; the caller does not wait on it. */
export const enqueue = (label: string, event: NostrEvent, relays: string[]): string => {
  if (relays.length === 0) throw new Error('no relays to broadcast to');
  const id = crypto.randomUUID();
  entries = [...entries, { id, label, event, relays, createdAt: Date.now(), status: 'queued', attempts: 0 }];
  persist();
  notify();
  void attempt(id);
  return id;
};

export const retryBroadcast = (id: string): void => {
  entries = entries.map((e) => (e.id === id ? { ...e, status: 'queued' as const, error: undefined } : e));
  persist();
  notify();
  void attempt(id);
};

export const retryAll = (): void => {
  for (const entry of entries) {
    if (entry.status === 'failed') retryBroadcast(entry.id);
  }
};

export const dismiss = remove;

export const subscribeQueue = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/** Come back online: everything that failed while offline retries. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => retryAll());
}

/** Tests start from an empty queue. */
export const resetQueue = (): void => {
  entries = [];
  inflight.clear();
  persist();
  notify();
};

export const queuedEntries = snapshot;
