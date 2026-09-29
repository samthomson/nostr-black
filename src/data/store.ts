import type { NostrEvent } from '@nostrify/nostrify';

/**
 * The event store: entity-keyed and normalized.
 *
 * This is what removes the duplication the app had when every hook owned
 * its own react-query cache entry — the same kind 0 was stored under three
 * different keys and fetched three times. Here an entity has exactly one
 * home, whoever asked for it and whichever relay delivered it.
 *
 * See `docs/data-layer.md` § Store.
 */

/**
 * `e:<id>` immutable events, `r:<kind>:<pubkey>` replaceable,
 * `a:<kind>:<pubkey>:<d>` addressable.
 */
export type EntityKey = string;

export const eventKey = (id: string): EntityKey => `e:${id}`;

export const replaceableKey = (kind: number, pubkey: string): EntityKey =>
  `r:${kind}:${pubkey}`;

export const addressableKey = (kind: number, pubkey: string, d: string): EntityKey =>
  `a:${kind}:${pubkey}:${d}`;

/** NIP-01 kind ranges. */
export const isReplaceable = (kind: number): boolean =>
  kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);

export const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;

export const isEphemeral = (kind: number): boolean => kind >= 20000 && kind < 30000;

/** The key an event is stored under, given its own kind. */
export const keyForEvent = (event: NostrEvent): EntityKey => {
  if (isReplaceable(event.kind)) return replaceableKey(event.kind, event.pubkey);
  if (isAddressable(event.kind)) {
    const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
    return addressableKey(event.kind, event.pubkey, d);
  }
  return eventKey(event.id);
};

/**
 * What the store knows about one entity. `settledAt` is set when a fetch
 * for this entity finished, hit or miss — it is how a component tells
 * "still loading" from "asked, and it genuinely does not exist".
 *
 * The object reference is stable until something actually changes, which
 * `useSyncExternalStore` requires or it re-renders forever.
 */
export interface EntityState {
  readonly event?: NostrEvent;
  /** ms epoch of the last completed fetch for this entity. */
  readonly settledAt?: number;
  /** Relays this event came back from — the engagement relay set. */
  readonly foundOn?: readonly string[];
}

const EMPTY: EntityState = Object.freeze({});

export interface TimeRange {
  since?: number;
  until?: number;
}

export interface StoreWatcher {
  onIngest(keys: readonly EntityKey[]): void;
  onClear(): void;
}

/**
 * NIP-01 replaceable conflict rule: higher `created_at` wins; on a tie the
 * lexicographically lower id wins. Applied on ingest regardless of which
 * relay delivered which copy, so the outcome does not depend on arrival
 * order.
 */
export const supersedes = (incoming: NostrEvent, existing: NostrEvent): boolean => {
  if (incoming.created_at !== existing.created_at) {
    return incoming.created_at > existing.created_at;
  }
  return incoming.id < existing.id;
};

/** Tags whose target this event is a response to — replies, reactions, quotes. */
const REF_TAGS = new Set(['e', 'E', 'q']);

export interface EventStore {
  get(key: EntityKey): EntityState;
  getEvent(id: string): NostrEvent | undefined;
  getReplaceable(kind: number, pubkey: string): NostrEvent | undefined;
  getAddressable(kind: number, pubkey: string, d: string): NostrEvent | undefined;
  /** Newest-first, for feed reads. */
  queryByAuthors(authors: readonly string[], kinds: readonly number[], range?: TimeRange): NostrEvent[];
  /** Every stored event of this kind. Reverse lookups (followers) use this. */
  queryByKind(kind: number): NostrEvent[];
  /** How many entities of each class are held — the debug page's inventory. */
  summary(): { events: number; replaceable: number; addressable: number };
  /** Ids of events that reference the given id — replies, reactions, reposts. */
  getRefs(targetId: string): ReadonlySet<string>;
  ingest(events: readonly NostrEvent[], from: string): void;
  /**
   * Load records that already have their provenance — cold-start hydration.
   * Does not notify store-wide watchers, so the persister can restore
   * without immediately writing the same rows back to disk.
   */
  restore(records: readonly { event: NostrEvent; foundOn: readonly string[] }[]): void;
  /** Mark a fetch as finished for these entities, whether or not it found anything. */
  settle(keys: Iterable<EntityKey>, at?: number): void;
  subscribe(key: EntityKey, onChange: () => void): () => void;
  /**
   * Store-wide mutations. Persist uses this; per-key `subscribe` is for
   * the UI and would miss keys nobody is looking at yet.
   */
  watch(listener: StoreWatcher): () => void;
  /** Drop everything. Subscribers are told, so nothing renders stale data. */
  clear(): void;
}

export const createStore = (): EventStore => {
  const entities = new Map<EntityKey, EntityState>();
  const listeners = new Map<EntityKey, Set<() => void>>();
  const watchers = new Set<StoreWatcher>();
  /** target id → ids of events referencing it. */
  const refs = new Map<string, Set<string>>();

  const notify = (keys: Iterable<EntityKey>): void => {
    for (const key of keys) {
      const subs = listeners.get(key);
      if (!subs) continue;
      for (const listener of [...subs]) listener();
    }
  };

  const notifyIngest = (keys: readonly EntityKey[]): void => {
    if (keys.length === 0) return;
    for (const watcher of [...watchers]) watcher.onIngest(keys);
  };

  const indexRefs = (event: NostrEvent): EntityKey[] => {
    const targets: EntityKey[] = [];
    for (const [name, target] of event.tags) {
      if (!REF_TAGS.has(name) || !target) continue;
      const set = refs.get(target) ?? new Set<string>();
      const grew = !set.has(event.id);
      set.add(event.id);
      refs.set(target, set);
      if (grew) targets.push(eventKey(target));
    }
    return targets;
  };

  const put = (
    event: NostrEvent,
    foundOn: readonly string[],
    current: EntityState | undefined,
  ): { key: EntityKey; refs: EntityKey[] } | undefined => {
    const key = keyForEvent(event);

    if (current?.event && !supersedes(event, current.event)) {
      if (current.event.id === event.id) {
        const merged = [...new Set([...(current.foundOn ?? []), ...foundOn])];
        if (merged.length !== (current.foundOn?.length ?? 0)) {
          entities.set(key, { ...current, foundOn: merged });
          return { key, refs: [] };
        }
      }
      return undefined;
    }

    const merged = current?.event?.id === event.id
      ? [...new Set([...(current.foundOn ?? []), ...foundOn])]
      : [...foundOn];

    entities.set(key, { event, settledAt: current?.settledAt, foundOn: merged });
    return { key, refs: indexRefs(event) };
  };

  const get = (key: EntityKey): EntityState => entities.get(key) ?? EMPTY;

  const ingest = (events: readonly NostrEvent[], from: string): void => {
    const changed = new Set<EntityKey>();

    const refTargets = new Set<EntityKey>();

    for (const event of events) {
      if (isEphemeral(event.kind)) continue;
      const result = put(event, [from], entities.get(keyForEvent(event)));
      if (!result) continue;
      changed.add(result.key);
      for (const ref of result.refs) refTargets.add(ref);
    }

    notify(changed);
    notify(refTargets);
    notifyIngest([...changed]);
  };

  const restore = (records: readonly { event: NostrEvent; foundOn: readonly string[] }[]): void => {
    const changed = new Set<EntityKey>();

    const refTargets = new Set<EntityKey>();

    for (const { event, foundOn } of records) {
      if (isEphemeral(event.kind)) continue;
      const result = put(event, foundOn, entities.get(keyForEvent(event)));
      if (!result) continue;
      changed.add(result.key);
      for (const ref of result.refs) refTargets.add(ref);
    }

    notify(changed);
    notify(refTargets);
  };

  const settle = (keys: Iterable<EntityKey>, at: number = Date.now()): void => {
    const changed = new Set<EntityKey>();
    for (const key of keys) {
      const current = get(key);
      if (current.settledAt === at) continue;
      entities.set(key, { ...current, settledAt: at });
      changed.add(key);
    }
    notify(changed);
  };

  const clear = (): void => {
    const held = [...entities.keys()];
    entities.clear();
    refs.clear();
    notify(held);
    for (const watcher of [...watchers]) watcher.onClear();
  };

  return {
    get,
    ingest,
    restore,
    settle,
    watch: (listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    clear,

    getEvent: (id) => get(eventKey(id)).event,

    getReplaceable: (kind, pubkey) => get(replaceableKey(kind, pubkey)).event,

    getAddressable: (kind, pubkey, d) => get(addressableKey(kind, pubkey, d)).event,

    queryByAuthors: (authors, kinds, range = {}) => {
      const wanted = new Set(authors);
      const wantedKinds = new Set(kinds);
      const out: NostrEvent[] = [];

      for (const { event } of entities.values()) {
        if (!event) continue;
        if (!wanted.has(event.pubkey) || !wantedKinds.has(event.kind)) continue;
        if (range.since !== undefined && event.created_at < range.since) continue;
        if (range.until !== undefined && event.created_at > range.until) continue;
        out.push(event);
      }

      return out.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    },

    queryByKind: (kind) => {
      const out: NostrEvent[] = [];
      for (const { event } of entities.values()) {
        if (event?.kind === kind) out.push(event);
      }
      return out;
    },

    summary: () => {
      let events = 0;
      let replaceable = 0;
      let addressable = 0;
      for (const [key, state] of entities) {
        if (!state.event) continue;
        if (key.startsWith('e:')) events += 1;
        else if (key.startsWith('r:')) replaceable += 1;
        else if (key.startsWith('a:')) addressable += 1;
      }
      return { events, replaceable, addressable };
    },

    getRefs: (targetId) => refs.get(targetId) ?? new Set<string>(),

    subscribe: (key, onChange) => {
      const subs = listeners.get(key) ?? new Set<() => void>();
      subs.add(onChange);
      listeners.set(key, subs);

      return () => {
        const current = listeners.get(key);
        if (!current) return;
        current.delete(onChange);
        if (current.size === 0) listeners.delete(key);
      };
    },
  };
};

/** The app's store. Tests build their own with `createStore()`. */
export const store: EventStore = createStore();
