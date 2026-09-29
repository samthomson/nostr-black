/**
 * Egress boundary — the ONLY module in the app that touches the network.
 * Nothing outside `src/net` may call `fetch`, construct a `WebSocket`, or
 * `invoke` a network command (see AGENTS.md, privacy doctrine).
 *
 * Internals are split by concern: `egress.ts` records what happened,
 * `io.ts` owns the two raw transports (Tauri bridge on desktop, WebSocket
 * on web), and `pool.ts` keeps connections warm and multiplexes many
 * requests over each one. This file is the protocol layer and the public
 * surface everything else imports.
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { verifyEvent as nostrVerifyEvent } from 'nostr-tools';
import { isDesktop } from './runtime';
import { leaseRelay, logPublish, type Frame, type LeaseHandlers } from './pool';
import {
  logQuery,
  logQueryDone,
  setEventRoute,
  setTransportRoute,
  type EgressEntry,
  type TransportRoute,
} from './egress';

export {
  egressLog,
  egressSession,
  resetEgressSession,
  getEventRoute,
  getTransportRoute,
  logEgress,
  logQuery,
  logQueryDone,
  setAuthSigner,
  setRoutePreference,
  setTransportRoute,
  type AuthSigner,
  type EgressEntry,
  type TransportRoute,
} from './egress';
export { closeAllConnections, poolStatus, setMaxConnections, getMaxConnections } from './pool';

// ─── Tor check ────────────────────────────────────────────────────────────

// Cert-bearing https onions from independent operators, raced via any().
const ONION_PROBES = [
  'https://facebookwkhpilnemxj7asaniu7vnjjbiltxjqhye3mhbshg7kx5tfyd.onion/',
  'https://protonmailrmez3lotccpshtdeeldrid3d5xgssot65nvldisoywqtu4ad.onion/',
  'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/',
] as const;
const PROBE_TIMEOUT_MS = 25000;

let torKnown: boolean | undefined;
let torInflight: Promise<boolean> | undefined;

const probeOnions = async (): Promise<boolean> => {
  if (isDesktop()) return true;
  try {
    await Promise.any(
      ONION_PROBES.map((url) =>
        fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
      ),
    );
    return true;
  } catch {
    return false;
  }
};

/** Tests only — each case must see a fresh probe. */
export const resetTorProbe = (): void => {
  torKnown = undefined;
  torInflight = undefined;
};

/** Desktop is Tor by construction; the web build probes https onions. */
export const isTor = async (): Promise<boolean> => {
  if (torKnown !== undefined) return torKnown;
  torInflight ??= probeOnions().then((result) => {
    torKnown = result;
    return result;
  });
  return torInflight;
};

// ─── NIP-01 REQ loop ─────────────────────────────────────────────────────

export interface RelayQueryOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const QUERY_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 5_000;

let subSeq = 0;

/**
 * One REQ over a warm connection: REQ → EVENT* → EOSE|CLOSED, then CLOSE so
 * the relay stops streaming. The socket itself stays open for the next
 * caller. NIP-42 is answered by the pool; we only re-send on `onAuthed`.
 */
const runQuery = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts,
  entry: EgressEntry,
): Promise<{ events: NostrEvent[]; route: TransportRoute | undefined; eose: boolean }> => {
  const subId = `q${++subSeq}`;
  const events: NostrEvent[] = [];
  const seen = new Set<string>();

  // Whether the relay said "that is all I have" or we simply stopped
  // waiting. The feed's completeness watermark cannot be computed without
  // telling those two apart.
  let eose = false;

  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  // Wired once the lease exists; the handlers below are needed to create it.
  let sendReq: () => void = () => {};

  const handlers: LeaseHandlers = {
    onFrame(frame: Frame) {
      const [type, a, b] = frame as [string, string, unknown];

      if (type === 'EVENT' && a === subId) {
        const event = b as NostrEvent;
        if (seen.has(event.id)) return;
        try {
          if (nostrVerifyEvent(event)) {
            seen.add(event.id);
            events.push(event);
          }
        } catch {
          // invalid event — skip
        }
        return;
      }
      if (type === 'EOSE' && a === subId) {
        eose = true;
        settle();
        return;
      }
      if (type === 'CLOSED' && a === subId) {
        const reason = typeof b === 'string' ? b : '';
        if (reason) entry.reason = reason.slice(0, 120);
        if (reason.includes('auth')) entry.status = 'auth';
        settle();
        return;
      }
      if (type === 'NOTICE' && typeof a === 'string' && a) {
        // Relays explain refusals via NOTICE (e.g. "auth-required") — capture
        // it so "empty" can be told apart from "refused".
        entry.reason = a.slice(0, 120);
        if (a.includes('auth')) {
          entry.status = 'auth';
          settle();
        }
      }
    },
    onAuthed: () => sendReq(),
    onAuthUnavailable(reason) {
      entry.status = 'auth';
      entry.reason = reason;
      settle();
    },
    onDisconnect(reason) {
      if (!entry.reason) entry.reason = reason;
      settle();
    },
  };

  const lease = await leaseRelay(url, subId, handlers);
  sendReq = () => lease.send(JSON.stringify(['REQ', subId, ...filters]));

  const timer = setTimeout(settle, opts.timeoutMs ?? QUERY_TIMEOUT_MS);
  const onAbort = () => settle();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    sendReq();
    await done;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    lease.send(JSON.stringify(['CLOSE', subId]));
    lease.release();
  }

  return { events, route: lease.route, eose };
};

/** One relay's answer, with enough detail to judge how complete it is. */
export interface RelayResult {
  url: string;
  events: NostrEvent[];
  /** The relay sent EOSE. False means we stopped waiting — a coverage gap. */
  eose: boolean;
}

export const queryRelayResult = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<RelayResult> => {
  const entry = logQuery(url, filters[0]?.kinds ?? [], filters[0]?.authors?.length);
  const startedAt = Date.now();

  let events: NostrEvent[] = [];
  let route: TransportRoute | undefined;
  let eose = false;
  try {
    const result = await runQuery(url, filters, opts, entry);
    events = result.events;
    route = result.route;
    eose = result.eose;
  } catch (e) {
    console.error(`[net] query failed for ${url}:`, e);
    entry.status = 'error';
    entry.reason = String(e).slice(0, 120);
  }

  // Rust reports the route actually used — source of truth for provenance.
  if (route) {
    entry.route = route;
    setTransportRoute(route);
  }
  for (const e of events) setEventRoute(e, route ?? 'direct');
  logQueryDone(entry, events.length, Date.now() - startedAt);
  return { url, events, eose };
};

export const queryRelay = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => (await queryRelayResult(url, filters, opts)).events;

/** Fan-out to many relays, merge + dedupe. */
export const queryRelays = async (
  urls: string[],
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const results = await Promise.all(urls.map((url) => queryRelay(url, filters, opts)));
  return [...new Map(results.flat().map((e) => [e.id, e])).values()];
};

// ─── Publish ─────────────────────────────────────────────────────────────

/** One EVENT over the warm connection, waiting for its OK. */
const publishToRelay = async (url: string, event: NostrEvent): Promise<void> => {
  logPublish(url);
  const subId = `p${++subSeq}`;

  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  // Wired once the lease exists; the handlers below are needed to create it.
  let sendEvent: () => void = () => {};

  const handlers: LeaseHandlers = {
    onFrame(frame: Frame) {
      const [type, id] = frame as [string, string];
      if (type === 'OK' && id === event.id) settle();
    },
    onAuthed: () => sendEvent(),
    onAuthUnavailable: () => settle(),
    onDisconnect: () => settle(),
  };

  const lease = await leaseRelay(url, subId, handlers);
  sendEvent = () => lease.send(JSON.stringify(['EVENT', event]));

  const timer = setTimeout(settle, PUBLISH_TIMEOUT_MS);
  try {
    sendEvent();
    await done;
  } finally {
    clearTimeout(timer);
    lease.release();
  }
};

/** Push one signed event to every relay. Fire-and-forget per relay:
 * one relay being down never blocks the others. */
export const publish = async (event: NostrEvent, relays: string[]): Promise<void> => {
  await Promise.allSettled(relays.map((url) => publishToRelay(url, event)));
};
