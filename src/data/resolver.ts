import { store, type EventStore } from './store';
import { scheduler, type Scheduler } from './scheduler';
import { extractWants } from './extract';
import { FEED_KINDS } from './feed/spec';

/**
 * Wires ingest to dependency prefetch.
 *
 * Every new event enqueues what it implies — the author's profile, reply
 * parents, quotes, mentions — at `prefetch`. Notes also enqueue an
 * engagement want so a page's counts ride the connections already open.
 * The UI never walks tags to decide what to fetch.
 */

const NOTE_KINDS = new Set<number>([...FEED_KINDS, 1]);

export const startResolver = (
  target: EventStore = store,
  sched: Scheduler = scheduler,
): (() => void) =>
  target.watch({
    onIngest: (keys) => {
      for (const key of keys) {
        const event = target.get(key).event;
        if (!event) continue;
        for (const want of extractWants(event)) {
          sched.want(want, 'prefetch');
        }
        if (NOTE_KINDS.has(event.kind)) {
          sched.want({ type: 'engagement', target: event.id }, 'prefetch');
        }
      }
    },
    onClear: () => undefined,
  });
