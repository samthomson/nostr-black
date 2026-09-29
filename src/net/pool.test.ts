import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RelayIo } from './io';

vi.mock('@/net/runtime', () => ({ isDesktop: () => false }));

/** Scriptable duplex double standing in for a real socket. */
class FakeIo implements RelayIo {
  static opened: FakeIo[] = [];
  sent: string[] = [];
  closed = false;
  frames: AsyncGenerator<string>;
  private queue: string[] = [];
  private wake: (() => void) | null = null;

  constructor(public url: string) {
    this.frames = this.streamFrames();
  }

  private async *streamFrames(): AsyncGenerator<string> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }

  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  /** Test driver: deliver a frame from the relay. */
  push(frame: unknown[]) {
    this.queue.push(JSON.stringify(frame));
    this.wake?.();
  }
  reqIds(): string[] {
    return this.sent
      .filter((m) => m.startsWith('["REQ"'))
      .map((m) => JSON.parse(m)[1] as string);
  }
}

let failNext = new Set<string>();

vi.mock('@/net/io', () => ({
  openIo: async (url: string) => {
    if (failNext.has(url)) throw new Error('connect refused');
    const io = new FakeIo(url);
    FakeIo.opened.push(io);
    return { io, route: undefined };
  },
}));

const { leaseRelay, closeAllConnections, poolStatus, setMaxConnections } = await import('./pool');
const { setAuthSigner } = await import('./egress');

const tick = () => new Promise((r) => setTimeout(r, 0));

const noopHandlers = () => ({
  frames: [] as unknown[][],
  authed: 0,
  authUnavailable: [] as string[],
  disconnects: [] as string[],
});

const handlersFor = (sink: ReturnType<typeof noopHandlers>) => ({
  onFrame: (f: unknown[]) => void sink.frames.push(f),
  onAuthed: () => void (sink.authed += 1),
  onAuthUnavailable: (r: string) => void sink.authUnavailable.push(r),
  onDisconnect: (r: string) => void sink.disconnects.push(r),
});

describe('relay connection pool', () => {
  beforeEach(() => {
    closeAllConnections();
    FakeIo.opened = [];
    failNext = new Set();
    setMaxConnections(16);
    setAuthSigner(undefined);
  });

  afterEach(() => {
    closeAllConnections();
    vi.useRealTimers();
  });

  it('opens one socket for concurrent subscriptions to the same relay', async () => {
    const a = noopHandlers();
    const b = noopHandlers();
    const [la, lb] = await Promise.all([
      leaseRelay('wss://one/', 'sub-a', handlersFor(a)),
      leaseRelay('wss://one/', 'sub-b', handlersFor(b)),
    ]);

    expect(FakeIo.opened).toHaveLength(1);
    expect(poolStatus()).toEqual([{ url: 'wss://one/', subs: 2, route: undefined }]);
    la.release();
    lb.release();
  });

  it('routes addressed frames only to their own subscription', async () => {
    const a = noopHandlers();
    const b = noopHandlers();
    await leaseRelay('wss://one/', 'sub-a', handlersFor(a));
    await leaseRelay('wss://one/', 'sub-b', handlersFor(b));
    const io = FakeIo.opened[0];

    io.push(['EVENT', 'sub-a', { id: 'x' }]);
    io.push(['EOSE', 'sub-b']);
    await tick();

    expect(a.frames).toEqual([['EVENT', 'sub-a', { id: 'x' }]]);
    expect(b.frames).toEqual([['EOSE', 'sub-b']]);
  });

  it('broadcasts connection-level frames to every subscription', async () => {
    const a = noopHandlers();
    const b = noopHandlers();
    await leaseRelay('wss://one/', 'sub-a', handlersFor(a));
    await leaseRelay('wss://one/', 'sub-b', handlersFor(b));

    FakeIo.opened[0].push(['NOTICE', 'slow down']);
    await tick();

    expect(a.frames).toEqual([['NOTICE', 'slow down']]);
    expect(b.frames).toEqual([['NOTICE', 'slow down']]);
  });

  it('answers a NIP-42 challenge once and tells every subscription to re-send', async () => {
    setAuthSigner(async (challenge) => ({
      id: 'auth',
      pubkey: 'p',
      kind: 22242,
      created_at: 0,
      tags: [['challenge', challenge]],
      content: '',
      sig: 's',
    }));
    const a = noopHandlers();
    const b = noopHandlers();
    await leaseRelay('wss://one/', 'sub-a', handlersFor(a));
    await leaseRelay('wss://one/', 'sub-b', handlersFor(b));
    const io = FakeIo.opened[0];

    io.push(['AUTH', 'chal-1']);
    await tick();
    io.push(['AUTH', 'chal-2']);
    await tick();

    const auths = io.sent.filter((m) => m.startsWith('["AUTH"'));
    expect(auths).toHaveLength(1);
    expect(auths[0]).toContain('chal-1');
    expect(a.authed).toBe(1);
    expect(b.authed).toBe(1);
    // AUTH is the pool's business; subscriptions never see the frame.
    expect(a.frames).toEqual([]);
  });

  it('reports auth as unavailable when there is no signer', async () => {
    const a = noopHandlers();
    await leaseRelay('wss://one/', 'sub-a', handlersFor(a));
    FakeIo.opened[0].push(['AUTH', 'chal']);
    await tick();

    expect(a.authUnavailable).toEqual(['relay requires auth (not logged in)']);
  });

  it('keeps the connection warm after release and reuses it', async () => {
    const first = await leaseRelay('wss://one/', 'sub-a', handlersFor(noopHandlers()));
    first.release();
    expect(FakeIo.opened[0].closed).toBe(false);

    const second = await leaseRelay('wss://one/', 'sub-b', handlersFor(noopHandlers()));
    expect(FakeIo.opened).toHaveLength(1);
    second.release();
  });

  it('closes an idle connection once the idle timer expires', async () => {
    vi.useFakeTimers();
    const lease = await leaseRelay('wss://one/', 'sub-a', handlersFor(noopHandlers()));
    lease.release();
    expect(poolStatus()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(46_000);

    expect(FakeIo.opened[0].closed).toBe(true);
    expect(poolStatus()).toEqual([]);
  });

  it('does not close a connection that still has subscriptions', async () => {
    vi.useFakeTimers();
    const keep = await leaseRelay('wss://one/', 'sub-a', handlersFor(noopHandlers()));
    const drop = await leaseRelay('wss://one/', 'sub-b', handlersFor(noopHandlers()));
    drop.release();

    await vi.advanceTimersByTimeAsync(46_000);

    expect(FakeIo.opened[0].closed).toBe(false);
    keep.release();
  });

  it('evicts the least recently used idle connection at the cap', async () => {
    setMaxConnections(2);
    const a = await leaseRelay('wss://a/', 's', handlersFor(noopHandlers()));
    const b = await leaseRelay('wss://b/', 's', handlersFor(noopHandlers()));
    a.release();
    await tick();
    b.release();

    await leaseRelay('wss://c/', 's', handlersFor(noopHandlers()));

    expect(poolStatus().map((p) => p.url).sort()).toEqual(['wss://b/', 'wss://c/']);
  });

  it('waits for a slot rather than exceeding the cap while all are busy', async () => {
    setMaxConnections(1);
    const busy = await leaseRelay('wss://a/', 's', handlersFor(noopHandlers()));

    let settled = false;
    const pending = leaseRelay('wss://b/', 's', handlersFor(noopHandlers())).then((l) => {
      settled = true;
      return l;
    });
    await tick();
    expect(settled).toBe(false);
    expect(poolStatus().map((p) => p.url)).toEqual(['wss://a/']);

    busy.release();
    const lease = await pending;
    expect(poolStatus().map((p) => p.url)).toEqual(['wss://b/']);
    lease.release();
  });

  it('tells every subscription when the socket dies', async () => {
    const a = noopHandlers();
    const b = noopHandlers();
    await leaseRelay('wss://one/', 'sub-a', handlersFor(a));
    await leaseRelay('wss://one/', 'sub-b', handlersFor(b));

    FakeIo.opened[0].close();
    await tick();

    expect(a.disconnects).toEqual(['connection closed']);
    expect(b.disconnects).toEqual(['connection closed']);
    expect(poolStatus()).toEqual([]);
  });

  it('backs off a relay that refuses to connect', async () => {
    failNext.add('wss://down/');
    await expect(leaseRelay('wss://down/', 's', handlersFor(noopHandlers()))).rejects.toThrow(
      'connect refused',
    );

    // Second attempt is refused by the backoff without touching the network.
    failNext.delete('wss://down/');
    await expect(leaseRelay('wss://down/', 's', handlersFor(noopHandlers()))).rejects.toThrow(
      /backing off/,
    );
    expect(FakeIo.opened).toHaveLength(0);
  });

  it('drops authenticated connections when the signer changes', async () => {
    setAuthSigner(async (challenge) => ({
      id: 'auth',
      pubkey: 'p',
      kind: 22242,
      created_at: 0,
      tags: [['challenge', challenge]],
      content: '',
      sig: 's',
    }));
    const authed = noopHandlers();
    await leaseRelay('wss://authed/', 's', handlersFor(authed));
    await leaseRelay('wss://plain/', 's', handlersFor(noopHandlers()));
    FakeIo.opened[0].push(['AUTH', 'chal']);
    await tick();

    // Switching accounts must not reuse a socket that authenticated as the
    // previous identity — the relay would link them.
    setAuthSigner(undefined);

    expect(poolStatus().map((p) => p.url)).toEqual(['wss://plain/']);
    expect(authed.disconnects).toEqual(['signer changed']);
  });

  it('keeps unauthenticated connections warm across a signer change', async () => {
    const lease = await leaseRelay('wss://plain/', 's', handlersFor(noopHandlers()));
    setAuthSigner(undefined);
    expect(poolStatus().map((p) => p.url)).toEqual(['wss://plain/']);
    lease.release();
  });

  it('shares one connection attempt between concurrent callers', async () => {
    const [a, b] = await Promise.all([
      leaseRelay('wss://one/', 'sub-a', handlersFor(noopHandlers())),
      leaseRelay('wss://one/', 'sub-b', handlersFor(noopHandlers())),
    ]);
    expect(FakeIo.opened).toHaveLength(1);
    a.release();
    b.release();
  });
});
