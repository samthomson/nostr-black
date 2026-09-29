import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { store, type EntityState } from '@/data/store';
import {
  scheduler,
  wantEntity,
  wantKey,
  type Lane,
  type ReplaceableWantType,
  type Want,
} from '@/data/scheduler';

/**
 * Reading the store from React.
 *
 * Every consumer of the same entity gets the same object back and the same
 * single network request, however many components ask — that is the point
 * of the store being entity-keyed rather than request-keyed.
 */

const EMPTY: EntityState = Object.freeze({});

/** True while nothing is known yet and no fetch has finished. */
export const isPending = (state: EntityState): boolean =>
  !state.event && state.settledAt === undefined;

/** Subscribe to one entity and declare the want that fills it. */
export const useEntity = (want: Want | undefined, lane: Lane = 'interactive'): EntityState => {
  const key = want ? wantEntity(want) : undefined;
  const id = want ? wantKey(want) : undefined;
  const latest = useRef(want);
  useEffect(() => {
    latest.current = want;
  });

  const subscribe = useCallback(
    (onChange: () => void) => (key ? store.subscribe(key, onChange) : () => {}),
    [key],
  );

  const snapshot = useCallback((): EntityState => (key ? store.get(key) : EMPTY), [key]);

  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    const w = latest.current;
    if (!w) return;
    scheduler.want(w, lane);
    return () => scheduler.drop(w);
  }, [id, lane]);

  return state;
};

/**
 * The same for a list whose length varies between renders — an account
 * switcher, a mention list — which rules out calling `useEntity` in a loop.
 */
export const useEntities = (
  type: ReplaceableWantType,
  pubkeys: readonly string[],
  lane: Lane = 'interactive',
): ReadonlyMap<string, EntityState> => {
  const joined = pubkeys.join(',');
  const version = useRef(0);
  const cache = useRef<{ id: string; version: number; value: Map<string, EntityState> } | undefined>(
    undefined,
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribes = keysOf(type, joined).map(({ key }) =>
        store.subscribe(key, () => {
          version.current += 1;
          onChange();
        }));
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [type, joined],
  );

  const snapshot = useCallback((): ReadonlyMap<string, EntityState> => {
    const hit = cache.current;
    if (hit && hit.id === joined && hit.version === version.current) return hit.value;

    const value = new Map(keysOf(type, joined).map(({ pubkey, key }) => [pubkey, store.get(key)]));
    cache.current = { id: joined, version: version.current, value };
    return value;
  }, [type, joined]);

  const states = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    const wants = keysOf(type, joined).map(({ pubkey }) => ({ type, pubkey }) as Want);
    for (const want of wants) scheduler.want(want, lane);
    return () => {
      for (const want of wants) scheduler.drop(want);
    };
  }, [type, joined, lane]);

  return states;
};

const keysOf = (type: ReplaceableWantType, id: string): { pubkey: string; key: string }[] =>
  id
    .split(',')
    .filter(Boolean)
    .map((pubkey) => ({
      pubkey,
      key: wantEntity({ type, pubkey }) ?? '',
    }));
