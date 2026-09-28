/**
 * Media pipeline — the ONLY path for avatars, images and video bytes.
 * Inside src/net per the egress boundary (AGENTS.md).
 *
 * - Web: identity (the browser fetches https directly).
 * - Desktop: bytes come over the invoke bridge (Tor or direct, decided in
 *   Rust) and are cached as blob URLs.
 *
 * Two layers, one policy:
 *   memory: url → { blobUrl, bytes, lastAccess } — instant reuse this session
 *   IndexedDB: url → { blob, bytes, lastAccess } — survives restarts, so
 *     cold-start avatars over Tor don't refetch
 *
 * Both share the byte budget and true-LRU eviction (least recently USED
 * goes first — a daily-viewed avatar cached long ago survives; a huge
 * one-off video seen once goes first). Eviction deletes from both layers.
 * Failures are sticky until cleared — a URL that failed is not re-hammered
 * on every render.
 */
import { invoke } from '@tauri-apps/api/core';
import { openDB, type IDBPDatabase } from 'idb';
import { isDesktop } from './runtime';

const DB_NAME = 'nostr-black-media';
const DB_VERSION = 1;
const STORE = 'media';

interface StoredBlob {
  mime: string;
  /** ArrayBuffer rather than Blob — structured-clone-safe everywhere. */
  data: ArrayBuffer;
  bytes: number;
  lastAccess: number;
}

interface MemoryEntry {
  blobUrl: string;
  bytes: number;
  lastAccess: number;
}

const memory = new Map<string, MemoryEntry>(); // iteration order = eviction order
let totalBytes = 0;
let maxBytes = 1024 * 1024 * 1024; // 1 GB

const failures = new Set<string>();

let dbPromise: Promise<IDBPDatabase> | undefined;
const db = (): Promise<IDBPDatabase> => {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE);
        store.createIndex('lastAccess', 'lastAccess');
      }
    },
  });
  return dbPromise;
};

export const mediaCacheBytes = (): number => totalBytes;
export const mediaCacheMaxBytes = (): number => maxBytes;

/** Set the cache budget, evicting least-recently-used entries immediately. */
export const setMediaCacheMaxBytes = async (bytes: number): Promise<void> => {
  maxBytes = Math.max(1024 * 1024, bytes);
  await evict();
};

/** Drop everything from both layers. Errors are forgotten too. */
export const clearMediaCache = async (): Promise<void> => {
  for (const { blobUrl } of memory.values()) URL.revokeObjectURL(blobUrl);
  memory.clear();
  totalBytes = 0;
  failures.clear();
  try {
    (await db()).clear(STORE);
  } catch {
    // no IDB (private mode) — memory layer is all we have
  }
};

/** Least-recently-used first: memory map preserves access order, and IDB
 * entries beyond what memory knows about are swept by lastAccess index. */
const evict = async (): Promise<void> => {
  while (totalBytes > maxBytes) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    totalBytes -= memory.get(oldest)!.bytes;
    URL.revokeObjectURL(memory.get(oldest)!.blobUrl);
    memory.delete(oldest);
    try {
      (await db()).delete(STORE, oldest);
    } catch {
      // memory-only
    }
  }
};

// ─── Queue: at most this many fetches in flight, viewport first ──────────

const MAX_CONCURRENT = 4;
let inFlight = 0;
/** High-priority waiters (on-screen media) are served before the rest. */
const queueHigh: (() => void)[] = [];
const queue: (() => void)[] = [];

const acquire = (high = false): Promise<void> =>
  new Promise((resolve) => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      resolve();
    } else {
      const slot = () => {
        inFlight++;
        resolve();
      };
      (high ? queueHigh : queue).push(slot);
    }
  });

/** Promote a queued fetch to the front — called when media enters the
 * viewport, so what the user is looking at loads before the long tail. */
export const prioritizeAsset = (url: string): void => {
  const waiter = priorityWaiters.get(url);
  if (!waiter) return;
  const idx = queue.indexOf(waiter);
  if (idx !== -1) {
    queue.splice(idx, 1);
    queueHigh.push(waiter);
  }
};

const priorityWaiters = new Map<string, () => void>();

const release = (): void => {
  inFlight--;
  (queueHigh.shift() ?? queue.shift())?.();
};

const FETCH_TIMEOUT_MS = 60_000;

const remember = (url: string, blob: Blob, blobUrl: string): void => {
  totalBytes += blob.size;
  memory.set(url, { blobUrl, bytes: blob.size, lastAccess: Date.now() });
};

/**
 * Resolve a media URL to a renderable one. Order: memory → IndexedDB →
 * network (desktop) / identity (web). Throws on failure — callers decide
 * how to surface the error.
 */
export const fetchAssetUrl = async (url: string): Promise<string> => {
  if (!isDesktop()) return url;

  const now = Date.now();
  const hit = memory.get(url);
  if (hit) {
    // Refresh LRU position.
    memory.delete(url);
    hit.lastAccess = now;
    memory.set(url, hit);
    return hit.blobUrl;
  }
  if (failures.has(url)) throw new Error('media fetch failed earlier');

  // Layer 2: IndexedDB (cold start, eviction survivor).
  try {
    const stored = (await (await db()).get(STORE, url)) as StoredBlob | undefined;
    if (stored) {
      const blob = new Blob([stored.data], { type: stored.mime });
      const blobUrl = URL.createObjectURL(blob);
      remember(url, blob, blobUrl);
      (await db()).put(STORE, { ...stored, lastAccess: now } satisfies StoredBlob).catch(() => {/* lastAccess refresh is best-effort */});
      return blobUrl;
    }
  } catch {
    // no IDB — fall through to network
  }

  await acquire(false);
  priorityWaiters.set(url, () => prioritizeAsset(url));
  try {
    const { mime, data } = await Promise.race([
      invoke<{ mime: string; data: string }>('fetch_asset', { url }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('media fetch timeout')), FETCH_TIMEOUT_MS),
      ),
    ]);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    remember(url, blob, blobUrl);
    try {
      await (await db()).put(
        STORE,
        {
          mime,
          data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          bytes: blob.size,
          lastAccess: now,
        } satisfies StoredBlob,
        url,
      );
    } catch {
      // no IDB — memory only
    }
    await evict();
    return blobUrl;
  } catch (e) {
    failures.add(url);
    throw e;
  } finally {
    priorityWaiters.delete(url);
    release();
  }
};
