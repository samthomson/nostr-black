import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { store } from '@/data/store';
import { refreshFeeds } from '@/data/feed/registry';

/**
 * The broadcast queue: every outgoing event passes through here.
 *
 * A broadcast that fails (offline, relay refusal) stays queued with its
 * error; success removes it — and lands in the sent log (the last five,
 * persisted) so the queue viewer can show what went where. The queue
 * survives reloads — an unsent note must never be lost to a refresh.
 * Entries hold already-signed events: signing happens at compose time,
 * the queue only transports bytes.
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

/** A delivered broadcast: kept so the queue viewer can show what went
 *  out recently, where, when — and what the note actually said. Newest
 *  first, capped — a log, not a second queue. */
export interface SentEntry {
  id: string;
  label: string;
  event: NostrEvent;
  relays: string[];
  sentAt: number;
}

const STORAGE_KEY = 'broadcast.queue';
const SENT_KEY = 'broadcast.sent';
const SENT_CAP = 5;
const listeners = new Set<() => void>();
const inflight = new Set<string>();
const load = <T,>(key: string): T[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
};

/** A stored sent entry: carries the whole signed event. Anything else
 *  (older-schema leftovers) is dropped at load, never rendered
 *  half-broken. */
const isSentEntry = (value: unknown): value is SentEntry =>
  typeof value === 'object' && value !== null
  && typeof (value as SentEntry).event?.id === 'string';

let entries: BroadcastEntry[] = load<BroadcastEntry>(STORAGE_KEY);
let sent: SentEntry[] = load<unknown>(SENT_KEY).filter(isSentEntry);

/** A broadcast just delivered: remember it (newest first, capped) so
 *  the queue viewer can show what went out recently. */
const recordSent = (entry: BroadcastEntry): void => {
  sent = [
    { id: entry.id, label: entry.label, event: entry.event, relays: entry.relays, sentAt: Date.now() },
    ...sent,
  ].slice(0, SENT_CAP);
};

const persist = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    localStorage.setItem(SENT_KEY, JSON.stringify(sent));
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
    recordSent(entry);
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

export const sentEntries = (): readonly SentEntry[] => sent;

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
  sent = [];
  inflight.clear();
  persist();
  notify();
};

export const queuedEntries = snapshot;
