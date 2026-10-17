import { useSyncExternalStore } from 'react';
import { queuedEntries, subscribeQueue, type BroadcastEntry } from '@/data/publish/queue';

/** The broadcast queue, bound to React: failed broadcasts stay until
 * retried or dismissed; success removes them. */
export const useBroadcastQueue = (): readonly BroadcastEntry[] =>
  useSyncExternalStore(subscribeQueue, queuedEntries, queuedEntries);
