import { useSyncExternalStore } from 'react';

/**
 * Burner pubkeys this identity has broadcast under. Only public keys —
 * the burner secrets live in the composer and die with it. The feed
 * includes these authors so your own burner notes render like any other
 * own note. Keyed by identity: switching identities never reads another
 * list; logout flushes it alongside the keystore.
 *
 * A subscribe/notify store (like the broadcast queue): remembering a
 * burner re-renders the feed with it in the author list.
 */

const keyOf = (identity: string): string => `burners.${identity}`;

const listeners = new Set<() => void>();
/** Read-through cache: identity → its burner pubkeys. */
const cache = new Map<string, readonly string[]>();

const read = (identity: string): readonly string[] => {
  try {
    const raw = localStorage.getItem(keyOf(identity));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
};

const get = (identity: string): readonly string[] => {
  const held = cache.get(identity);
  if (held) return held;
  const loaded = read(identity);
  cache.set(identity, loaded);
  return loaded;
};

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

export const rememberBurner = (identity: string, burner: string): void => {
  const list = get(identity);
  if (list.includes(burner)) return;
  const next = [...list, burner];
  cache.set(identity, next);
  try {
    localStorage.setItem(keyOf(identity), JSON.stringify(next));
  } catch {
    // Storage unavailable: burner notes just won't persist across reloads.
  }
  notify();
};

export const flushBurners = (identity: string): void => {
  if (!cache.has(identity) && read(identity).length === 0) return;
  cache.delete(identity);
  try {
    localStorage.removeItem(keyOf(identity));
  } catch {
    // Storage unavailable: nothing was persisted.
  }
  notify();
};

/** Tests start with no remembered burners. */
export const resetBurners = (): void => {
  cache.clear();
  notify();
};

/** This identity's burner pubkeys — the imperative read. */
export const burnersOf: (identity: string) => readonly string[] = get;

export const subscribeBurners = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/** This identity's burner pubkeys, live. */
export const useMyBurners = (identity: string | undefined): readonly string[] =>
  useSyncExternalStore(
    subscribeBurners,
    () => (identity ? get(identity) : EMPTY),
    () => EMPTY,
  );

const EMPTY: readonly string[] = [];
