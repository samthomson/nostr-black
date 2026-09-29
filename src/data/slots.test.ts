import { describe, expect, it } from 'vitest';
import { canStart, createSlotLimiter, type LaneCounts } from './slots';

const counts = (over: Partial<LaneCounts> = {}): LaneCounts =>
  ({ interactive: 0, prefetch: 0, background: 0, ...over });

const FLOORS: LaneCounts = { interactive: 4, prefetch: 2, background: 1 };
const GLOBAL = 10;

describe('canStart', () => {
  it('always lets a lane inside its own floor through', () => {
    // Global is saturated by other lanes, but the floor is a guarantee.
    expect(canStart('background', counts({ interactive: 9 }), FLOORS, GLOBAL)).toBe(true);
  });

  it('lets a lane burst into capacity nobody is reserving', () => {
    // Only interactive is active: 4 used, 3 reserved for the others,
    // so it may keep going up to 7.
    expect(canStart('interactive', counts({ interactive: 6 }), FLOORS, GLOBAL)).toBe(true);
    expect(canStart('interactive', counts({ interactive: 7 }), FLOORS, GLOBAL)).toBe(false);
  });

  it('stops a lane from eating another lane\'s reserve', () => {
    // Floors sum to 7 of 10, leaving 3 spare. Alone, prefetch may take its
    // own 2 plus all 3 spare — and not one more, because the remaining 5
    // belong to interactive and background whether they are using them yet
    // or not.
    expect(canStart('prefetch', counts({ prefetch: 4 }), FLOORS, GLOBAL)).toBe(true);
    expect(canStart('prefetch', counts({ prefetch: 5 }), FLOORS, GLOBAL)).toBe(false);
  });

  it('counts a lane\'s own use against it, not on top of its reserve', () => {
    // background taking its reserved slot must not shrink what prefetch
    // could already have had — the slot moves from reserved to in-flight.
    expect(canStart('prefetch', counts({ prefetch: 3 }), FLOORS, GLOBAL)).toBe(true);
    expect(canStart('prefetch', counts({ prefetch: 3, background: 1 }), FLOORS, GLOBAL)).toBe(true);
  });

  it('never exceeds the global cap', () => {
    const saturated = counts({ interactive: 5, prefetch: 4, background: 1 });
    expect(canStart('interactive', saturated, FLOORS, GLOBAL)).toBe(false);
    expect(canStart('prefetch', saturated, FLOORS, GLOBAL)).toBe(false);
    expect(canStart('background', saturated, FLOORS, GLOBAL)).toBe(false);
  });
});

describe('slot limiter', () => {
  it('admits up to the cap and queues the rest', async () => {
    const limiter = createSlotLimiter({ interactive: 2, prefetch: 0, background: 0 }, 2);

    const first = await limiter.acquire('interactive');
    await limiter.acquire('interactive');
    expect(limiter.inflight().interactive).toBe(2);

    let third = false;
    void limiter.acquire('interactive').then(() => { third = true; });
    await Promise.resolve();
    expect(third).toBe(false);

    first();
    await Promise.resolve();
    await Promise.resolve();
    expect(third).toBe(true);
  });

  it('wakes the most urgent lane first', async () => {
    const limiter = createSlotLimiter({ interactive: 0, prefetch: 0, background: 0 }, 1);
    const release = await limiter.acquire('background');

    const woken: string[] = [];
    void limiter.acquire('background').then(() => woken.push('background'));
    void limiter.acquire('interactive').then(() => woken.push('interactive'));
    await Promise.resolve();

    release();
    await Promise.resolve();
    await Promise.resolve();

    // Queued second, but interactive outranks background.
    expect(woken).toEqual(['interactive']);
  });

  it('guarantees a floor even when another lane is flooding', async () => {
    const limiter = createSlotLimiter({ interactive: 2, prefetch: 0, background: 0 }, 4);

    // A scroll flood asks for far more than it can have.
    for (let i = 0; i < 20; i += 1) void limiter.acquire('prefetch');
    await Promise.resolve();

    // It is capped short of the global, holding interactive's 2 in reserve.
    expect(limiter.inflight().prefetch).toBe(2);

    // So an on-screen avatar is admitted immediately, not queued behind 20.
    let admitted = false;
    void limiter.acquire('interactive').then(() => { admitted = true; });
    await Promise.resolve();
    expect(admitted).toBe(true);
  });

  it('ignores a release called twice', async () => {
    const limiter = createSlotLimiter({ interactive: 1, prefetch: 0, background: 0 }, 1);
    const release = await limiter.acquire('interactive');

    release();
    release();
    expect(limiter.inflight().interactive).toBe(0);
  });
});
