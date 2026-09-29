/**
 * REQ slot budgeting.
 *
 * Warm multiplexed connections broke the old "one query = one socket = one
 * Tor circuit" equivalence, so the budget splits in two: `src/net/pool.ts`
 * caps *connections*, because circuit setup is the scarce thing, and this
 * caps *in-flight requests*, because a runaway fan-out is still a runaway
 * fan-out even when it costs no new sockets.
 *
 * Lanes get a guaranteed floor and may burst into whatever nobody is
 * reserving. Floors rather than a fixed partition: hydration must not be
 * starved by a page fetch, a page fetch must not be starved by a scroll
 * flood, and neither should hold capacity it is not using.
 *
 * See `docs/data-layer.md` § The connection budget.
 */

/** `interactive` is on screen, `prefetch` is offscreen, `background` polls. */
export type Lane = 'interactive' | 'prefetch' | 'background';

/** Drain order, highest first. */
export const LANES: readonly Lane[] = ['interactive', 'prefetch', 'background'];

export type LaneCounts = Readonly<Record<Lane, number>>;

const FLOORS: LaneCounts = { interactive: 8, prefetch: 4, background: 2 };

/** Backstop against a runaway fan-out, well above the sum of the floors. */
const GLOBAL_REQS = 24;

export const rank = (lane: Lane): number => LANES.indexOf(lane);

/**
 * Whether `lane` may start another request. Inside its own floor, always.
 * Beyond it, only into capacity no other lane is holding in reserve.
 */
export const canStart = (
  lane: Lane,
  inflight: LaneCounts,
  floors: LaneCounts = FLOORS,
  global: number = GLOBAL_REQS,
): boolean => {
  if (inflight[lane] < floors[lane]) return true;

  const reserved = LANES
    .filter((other) => other !== lane)
    .reduce((sum, other) => sum + Math.max(0, floors[other] - inflight[other]), 0);
  const total = LANES.reduce((sum, l) => sum + inflight[l], 0);

  return total + reserved < global;
};

export interface SlotLimiter {
  /** Resolves when the lane may proceed; call the returned release when done. */
  acquire(lane: Lane): Promise<() => void>;
  inflight(): LaneCounts;
}

export const createSlotLimiter = (
  floors: LaneCounts = FLOORS,
  global: number = GLOBAL_REQS,
): SlotLimiter => {
  const inflight: Record<Lane, number> = { interactive: 0, prefetch: 0, background: 0 };
  const waiting: Record<Lane, (() => void)[]> = {
    interactive: [],
    prefetch: [],
    background: [],
  };

  let releasing = false;

  const pump = (): void => {
    // Re-entrancy guard: a woken waiter may acquire again synchronously.
    if (releasing) return;
    releasing = true;
    try {
      for (const lane of LANES) {
        while (waiting[lane].length > 0 && canStart(lane, inflight, floors, global)) {
          inflight[lane] += 1;
          waiting[lane].shift()!();
        }
      }
    } finally {
      releasing = false;
    }
  };

  const release = (lane: Lane): void => {
    inflight[lane] -= 1;
    pump();
  };

  return {
    acquire: (lane) => {
      let released = false;
      const done = () => {
        if (released) return;
        released = true;
        release(lane);
      };

      if (waiting[lane].length === 0 && canStart(lane, inflight, floors, global)) {
        inflight[lane] += 1;
        return Promise.resolve(done);
      }

      return new Promise<() => void>((resolve) => {
        waiting[lane].push(() => resolve(done));
      });
    },

    inflight: () => ({ ...inflight }),
  };
};
