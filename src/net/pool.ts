/**
 * Warm relay connections, multiplexed.
 *
 * One socket per relay, shared by every concurrent REQ and EVENT, each
 * distinguished by its own subscription id. Connections stay open after a
 * query finishes and close on an idle timer, so the next query reuses the
 * circuit instead of building a new one.
 *
 * This matters most over Tor, where circuit setup — not bandwidth — is the
 * dominant cost. It is also what makes engagement queries affordable: they
 * target the relays a page already came from, so they open no new sockets.
 *
 * NIP-42 AUTH is handled here rather than per query: one challenge per
 * connection, answered once, with every active subscription told to re-send.
 */

import { openIo, type RelayIo } from './io';
import { getAuthSigner, logEgress, onAuthSignerChange, type TransportRoute } from './egress';
import { isDesktop } from './runtime';

export type Frame = unknown[];

export interface LeaseHandlers {
  /**
   * Frames addressed to this subscription, plus connection-level frames
   * (NOTICE, OK) which every subscription sees. AUTH never reaches here —
   * the pool answers it.
   */
  onFrame(frame: Frame): void;
  /** The connection authenticated. Re-send whatever was in flight. */
  onAuthed(): void;
  /** The relay demanded auth we cannot provide. */
  onAuthUnavailable(reason: string): void;
  /** The socket is gone. */
  onDisconnect(reason: string): void;
}

export interface RelayLease {
  readonly route: TransportRoute | undefined;
  /** No-op once the connection is gone, so callers never have to check. */
  send(text: string): void;
  release(): void;
}

/**
 * Circuit budget. Circuit setup is the scarce resource over Tor, so this
 * caps *connections*, not in-flight requests — many REQs share one socket.
 * Lane-level request budgeting arrives with the scheduler.
 */
let maxConnections = isDesktop() ? 8 : 16;

/** Tor allows fewer circuits than clearnet; the desktop toggle moves this. */
export const setMaxConnections = (n: number): void => {
  maxConnections = Math.max(1, n);
};

export const getMaxConnections = (): number => maxConnections;

/** How long a connection with no subscriptions stays open. */
const IDLE_MS = 45_000;

/** A relay that refuses to connect is backed off, doubling to this ceiling. */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

interface Sub {
  handlers: LeaseHandlers;
}

interface Conn {
  url: string;
  io: RelayIo;
  route: TransportRoute | undefined;
  subs: Map<string, Sub>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  lastUsed: number;
  dead: boolean;
  /** One AUTH attempt per connection; a second challenge is not retried. */
  authAttempted: boolean;
}

const conns = new Map<string, Conn>();
/** In-flight opens, so concurrent callers share one connection attempt. */
const opening = new Map<string, Promise<Conn>>();
const backoff = new Map<string, { failures: number; until: number }>();
/** Woken when a connection closes or goes idle and a slot may be free. */
const slotWaiters: (() => void)[] = [];

const wakeSlotWaiter = (): void => {
  slotWaiters.shift()?.();
};

const dropConn = (conn: Conn): void => {
  if (conns.get(conn.url) === conn) conns.delete(conn.url);
  if (conn.idleTimer) clearTimeout(conn.idleTimer);
  conn.idleTimer = undefined;
  wakeSlotWaiter();
};

const closeConn = (conn: Conn, reason: string): void => {
  if (conn.dead) return;
  conn.dead = true;
  const subs = [...conn.subs.values()];
  conn.subs.clear();
  try {
    conn.io.close();
  } catch {
    // already closed
  }
  dropConn(conn);
  for (const sub of subs) sub.handlers.onDisconnect(reason);
};

const scheduleIdleClose = (conn: Conn): void => {
  if (conn.idleTimer) clearTimeout(conn.idleTimer);
  conn.idleTimer = setTimeout(() => closeConn(conn, 'idle'), IDLE_MS);
  // A connection with no subscriptions is evictable — let anyone waiting
  // for a slot take it now rather than after the full idle timeout.
  wakeSlotWaiter();
};

const handleAuth = async (conn: Conn, challenge: string): Promise<void> => {
  const signer = getAuthSigner();
  if (!signer) {
    for (const sub of conn.subs.values()) {
      sub.handlers.onAuthUnavailable('relay requires auth (not logged in)');
    }
    return;
  }
  if (conn.authAttempted) return;
  conn.authAttempted = true;
  try {
    const authEvent = await signer(challenge, conn.url);
    if (conn.dead) return;
    conn.io.send(JSON.stringify(['AUTH', authEvent]));
    for (const sub of conn.subs.values()) sub.handlers.onAuthed();
  } catch {
    for (const sub of conn.subs.values()) {
      sub.handlers.onAuthUnavailable('auth signing failed');
    }
  }
};

/** EVENT / EOSE / CLOSED name their subscription; everything else is shared. */
const ADDRESSED = new Set(['EVENT', 'EOSE', 'CLOSED']);

const dispatch = (conn: Conn, frame: Frame): void => {
  const [type, a] = frame as [string, string];

  if (type === 'AUTH' && typeof a === 'string') {
    void handleAuth(conn, a);
    return;
  }
  if (ADDRESSED.has(type)) {
    conn.subs.get(a)?.handlers.onFrame(frame);
    return;
  }
  for (const sub of conn.subs.values()) sub.handlers.onFrame(frame);
};

const pump = async (conn: Conn): Promise<void> => {
  try {
    for await (const text of conn.io.frames) {
      if (conn.dead) return;
      let frame: Frame;
      try {
        frame = JSON.parse(text) as Frame;
      } catch {
        continue;
      }
      if (Array.isArray(frame)) dispatch(conn, frame);
    }
  } finally {
    closeConn(conn, 'connection closed');
  }
};

/** Free a slot by evicting the least recently used connection with no subscriptions. */
const evictIdle = (): boolean => {
  let victim: Conn | undefined;
  for (const conn of conns.values()) {
    if (conn.subs.size > 0) continue;
    if (!victim || conn.lastUsed < victim.lastUsed) victim = conn;
  }
  if (!victim) return false;
  closeConn(victim, 'evicted');
  return true;
};

const awaitSlot = async (): Promise<void> => {
  while (conns.size >= maxConnections) {
    if (evictIdle()) return;
    await new Promise<void>((resolve) => slotWaiters.push(resolve));
  }
};

const noteFailure = (url: string): void => {
  const prev = backoff.get(url);
  const failures = (prev?.failures ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
  backoff.set(url, { failures, until: Date.now() + delay });
};

const openConn = async (url: string): Promise<Conn> => {
  await awaitSlot();
  const { io, route } = await openIo(url);
  const conn: Conn = {
    url,
    io,
    route,
    subs: new Map(),
    idleTimer: undefined,
    lastUsed: Date.now(),
    dead: false,
    authAttempted: false,
  };
  conns.set(url, conn);
  void pump(conn);
  return conn;
};

const getConn = async (url: string): Promise<Conn> => {
  const existing = conns.get(url);
  if (existing && !existing.dead) return existing;

  const pending = opening.get(url);
  if (pending) return pending;

  const state = backoff.get(url);
  if (state && Date.now() < state.until) {
    throw new Error(`relay backing off for ${state.until - Date.now()}ms`);
  }

  const attempt = openConn(url)
    .then((conn) => {
      backoff.delete(url);
      return conn;
    })
    .catch((e: unknown) => {
      noteFailure(url);
      throw e;
    })
    .finally(() => {
      opening.delete(url);
    });

  opening.set(url, attempt);
  return attempt;
};

/**
 * Take a subscription slot on a warm connection to `url`. The caller owns
 * `subId` and must `release()` when done — the connection stays open for
 * the next caller and closes on its own once idle.
 */
export const leaseRelay = async (
  url: string,
  subId: string,
  handlers: LeaseHandlers,
): Promise<RelayLease> => {
  const conn = await getConn(url);
  if (conn.idleTimer) {
    clearTimeout(conn.idleTimer);
    conn.idleTimer = undefined;
  }
  conn.subs.set(subId, { handlers });
  conn.lastUsed = Date.now();

  let released = false;
  return {
    route: conn.route,
    send: (text) => {
      if (conn.dead || released) return;
      conn.io.send(text);
    },
    release: () => {
      if (released) return;
      released = true;
      conn.subs.delete(subId);
      conn.lastUsed = Date.now();
      if (!conn.dead && conn.subs.size === 0) scheduleIdleClose(conn);
    },
  };
};

/**
 * A connection that answered a NIP-42 challenge is bound to whoever signed
 * it. Reusing one after the identity changes would let a relay link the two
 * accounts, so those sockets are dropped on every signer change. Connections
 * that never authenticated carry no identity and stay warm.
 */
const closeAuthenticated = (): void => {
  for (const conn of [...conns.values()]) {
    if (conn.authAttempted) closeConn(conn, 'signer changed');
  }
};
onAuthSignerChange(closeAuthenticated);

/** Publish logging keeps its own entry so the debug page still shows sends. */
export const logPublish = (url: string): void => logEgress('http', url);

/** Close everything — logout, account switch, and tests between cases. */
export const closeAllConnections = (): void => {
  for (const conn of [...conns.values()]) closeConn(conn, 'shutdown');
  conns.clear();
  opening.clear();
  backoff.clear();
  slotWaiters.splice(0).forEach((resolve) => resolve());
};

/** Debug page: what is currently held open. */
export const poolStatus = (): { url: string; subs: number; route: TransportRoute | undefined }[] =>
  [...conns.values()].map((c) => ({ url: c.url, subs: c.subs.size, route: c.route }));
