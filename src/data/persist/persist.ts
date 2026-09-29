import { store as appStore, type EventStore } from '@/data/store';
import { FEED_KINDS } from '@/data/feed/spec';
import { getCodec, type PersistedRecord } from './codec';
import {
  ADDRESSABLE,
  database,
  deleteDatabase,
  ENTITY_STORES,
  EVENTS,
  META,
  REPLACEABLE,
  storeForKey,
  type EntityStoreName,
  type Row,
} from './db';

/**
 * Write-behind persistence.
 *
 * Ingest never touches disk. Dirty keys sit in a set until a short timer
 * or a count threshold fires, then one transaction writes them all. Cold
 * start hydrates every replaceable (and addressable) record plus the most
 * recently written feed notes plus a separate window of replies/reactions,
 * then the feed can render from memory while the network reconciles behind it.
 *
 * See `docs/data-layer.md` § Persistence.
 */

const FLUSH_MS = 250;
const FLUSH_COUNT = 24;
/** Feed notes (kind 1, reposts, media, long-form). Replies/reactions have their own cap. */
const EVENT_WINDOW = 200;
/** Kind 7 / 9735 / 1111 etc. — must not steal slots from the feed window. */
const ENGAGEMENT_WINDOW = 1000;
const SEQ = 'seq';
const FEED_KIND = new Set(FEED_KINDS);

export interface Persister {
  start(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
  wipe(): Promise<void>;
  subscribeReady(onChange: () => void): () => void;
  isReady(): boolean;
}

export interface PersisterOpts {
  flushMs?: number;
  flushCount?: number;
  eventWindow?: number;
  engagementWindow?: number;
}

export const createPersister = (target: EventStore, opts: PersisterOpts = {}): Persister => {
  const flushMs = opts.flushMs ?? FLUSH_MS;
  const flushCount = opts.flushCount ?? FLUSH_COUNT;
  const eventWindow = opts.eventWindow ?? EVENT_WINDOW;
  const engagementWindow = opts.engagementWindow ?? ENGAGEMENT_WINDOW;

  const dirty = new Set<string>();
  const readyListeners = new Set<() => void>();
  let ready = false;
  let nextSeq = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  let writing: Promise<void> | undefined;
  let gate: Promise<void> = Promise.resolve();

  const setReady = (value: boolean): void => {
    if (ready === value) return;
    ready = value;
    for (const listener of [...readyListeners]) listener();
  };

  const schedule = (): void => {
    if (dirty.size >= flushCount) {
      void flush();
      return;
    }
    if (timer !== undefined || dirty.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, flushMs);
  };

  const onIngest = (keys: readonly string[]): void => {
    for (const key of keys) dirty.add(key);
    schedule();
  };

  const onClear = (): void => {
    // Memory was wiped; pending writes would put those rows back.
    dirty.clear();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const decodeRow = async (row: Row): Promise<PersistedRecord> =>
    getCodec().decode(row.body);

  const loadStore = async (name: EntityStoreName, limit?: number): Promise<PersistedRecord[]> => {
    const db = await database();
    const rows = limit === undefined
      ? await db.getAll(name)
      : (await db.getAllFromIndex(name, 'seq')).slice(-limit);

    const records: PersistedRecord[] = [];
    for (const row of rows) records.push(await decodeRow(row));
    return records;
  };

  const loadEventsWindow = async (): Promise<PersistedRecord[]> => {
    const db = await database();
    const rows = await db.getAllFromIndex(EVENTS, 'seq');
    const feed: PersistedRecord[] = [];
    const rest: PersistedRecord[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (feed.length >= eventWindow && rest.length >= engagementWindow) break;
      const record = await decodeRow(rows[i]);
      if (FEED_KIND.has(record.event.kind)) {
        if (feed.length < eventWindow) feed.push(record);
      } else if (rest.length < engagementWindow) {
        rest.push(record);
      }
    }
    return [...feed, ...rest];
  };

  const hydrate = async (): Promise<void> => {
    const [replaceable, addressable, events] = await Promise.all([
      loadStore(REPLACEABLE),
      loadStore(ADDRESSABLE),
      loadEventsWindow(),
    ]);
    target.restore([...replaceable, ...addressable, ...events]);
  };

  const flush = async (): Promise<void> => {
    if (writing) {
      await writing;
      if (dirty.size === 0) return;
    }

    const keys = [...dirty];
    dirty.clear();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (keys.length === 0) return;

    const writes: { key: string; row: Row }[] = [];
    for (const key of keys) {
      const state = target.get(key);
      if (!state.event) continue;
      writes.push({
        key,
        row: {
          seq: nextSeq,
          body: await getCodec().encode({
            event: state.event,
            foundOn: state.foundOn ?? [],
          }),
        },
      });
      nextSeq += 1;
    }
    if (writes.length === 0) return;

    const run = async (): Promise<void> => {
      const db = await database();
      const tx = db.transaction([...ENTITY_STORES, META], 'readwrite');
      for (const { key, row } of writes) {
        await tx.objectStore(storeForKey(key)).put(row, key);
      }
      await tx.objectStore(META).put(nextSeq, SEQ);
      await tx.done;
    };

    writing = run();
    try {
      await writing;
    } finally {
      writing = undefined;
    }
  };

  const wipe = async (): Promise<void> => {
    dirty.clear();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    nextSeq = 1;
    const db = await database();
    const tx = db.transaction([...ENTITY_STORES, META], 'readwrite');
    for (const name of ENTITY_STORES) await tx.objectStore(name).clear();
    await tx.objectStore(META).delete(SEQ);
    await tx.done;
  };

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const run = gate.then(work, work);
    gate = run.then(() => undefined, () => undefined);
    return run;
  };

  const start = (): Promise<void> => enqueue(async () => {
    if (unwatch) return;
    const db = await database();
    const stored = await db.get(META, SEQ);
    nextSeq = typeof stored === 'number' ? stored : 1;
    await hydrate();
    unwatch = target.watch({ onIngest, onClear });
    setReady(true);
  });

  const stop = (): Promise<void> => enqueue(async () => {
    unwatch?.();
    unwatch = undefined;
    await flush();
    setReady(false);
  });

  return {
    start,
    stop,
    flush,
    wipe,
    subscribeReady: (onChange) => {
      readyListeners.add(onChange);
      return () => readyListeners.delete(onChange);
    },
    isReady: () => ready,
  };
};

/** The app's persister. Tests build their own with `createPersister()`. */
export const persister: Persister = createPersister(appStore);

/** Close the handle and delete the database. Tests start from empty disk. */
export const resetPersist = async (): Promise<void> => {
  await persister.stop();
  await persister.wipe();
  await deleteDatabase();
};
