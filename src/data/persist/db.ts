import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Encoded } from './codec';

/**
 * The on-disk schema, alongside the existing `nostr-black-media`.
 *
 * Note what is *not* here: an index on `pubkey` or `created_at`. The plan
 * originally called for both, but an index is plaintext by definition, and
 * an index over authors and timestamps is the social graph — the single
 * most sensitive thing this app holds. Once the codec encrypts the body,
 * such an index would be the only readable part of the file and would
 * describe who you follow and when you read.
 *
 * So rows carry exactly one clear column: `seq`, a local insertion
 * counter. It orders eviction and bounds hydration, and it reveals only
 * how many events were cached and in what order they arrived.
 *
 * See `docs/data-layer.md` § Persistence.
 */

const DB_NAME = 'nostr-black-data';
const DB_VERSION = 1;

export const EVENTS = 'events';
export const REPLACEABLE = 'replaceable';
export const ADDRESSABLE = 'addressable';
export const META = 'meta';

/** Every entity store holds the same row shape, keyed by its entity key. */
export interface Row {
  /** Local insertion order. The only column the codec does not cover. */
  seq: number;
  body: Encoded;
}

interface DataSchema extends DBSchema {
  [EVENTS]: { key: string; value: Row; indexes: { seq: number } };
  [REPLACEABLE]: { key: string; value: Row; indexes: { seq: number } };
  [ADDRESSABLE]: { key: string; value: Row; indexes: { seq: number } };
  [META]: { key: string; value: unknown };
}

export type DataDB = IDBPDatabase<DataSchema>;

/** The entity stores, i.e. everything except `meta`. */
export const ENTITY_STORES = [EVENTS, REPLACEABLE, ADDRESSABLE] as const;
export type EntityStoreName = (typeof ENTITY_STORES)[number];

/**
 * Which store an entity key belongs in. The prefix already encodes it —
 * see `store.ts` — so this stays a pure function of the key.
 */
export const storeForKey = (key: string): EntityStoreName => {
  if (key.startsWith('r:')) return REPLACEABLE;
  if (key.startsWith('a:')) return ADDRESSABLE;
  return EVENTS;
};

let handle: Promise<DataDB> | undefined;

export const database = (): Promise<DataDB> => {
  handle ??= openDB<DataSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const name of ENTITY_STORES) {
        db.createObjectStore(name).createIndex('seq', 'seq');
      }
      db.createObjectStore(META);
    },
  });
  return handle;
};

/** Drops the cached handle so the next `database()` reopens. For tests. */
export const closeDatabase = async (): Promise<void> => {
  if (!handle) return;
  const db = await handle;
  handle = undefined;
  db.close();
};

/** Closes and deletes the database. Tests start from an empty disk. */
export const deleteDatabase = async (): Promise<void> => {
  await closeDatabase();
  await deleteDB(DB_NAME);
};
