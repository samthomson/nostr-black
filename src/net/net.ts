/**
 * Egress boundary — the ONLY module in the app that touches the network.
 * Nothing outside `src/net` may call `fetch`, construct a `WebSocket`, or
 * `invoke` a network command (see AGENTS.md, privacy doctrine).
 *
 * Runtime detection lives in runtime.ts (imported, never inlined).
 * The transport is picked once at module init:
 *   - web: direct browser connections behind the Tor gate
 *   - desktop: Rust/arti over invoke (Tor by construction)
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { verifyEvent as nostrVerifyEvent } from 'nostr-tools';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './runtime';

// ─── Egress log (debug page) ─────────────────────────────────────────────

export type TransportRoute = 'tor' | 'direct';

/** Current desktop transport route. Synced from the toggle (ConnectionStatus)
 * so every query log entry and note-provenance stamp reflects reality. */
let transportRoute: TransportRoute | undefined = isDesktop() ? 'tor' : undefined;
export const setTransportRoute = (route: TransportRoute): void => {
  transportRoute = route;
};
export const getTransportRoute = (): TransportRoute | undefined => transportRoute;

/** Flip the desktop route: Rust picks it up for every new connection; the
 * optimistic JS stamp is corrected by the next query's reported route. */
export const setRoutePreference = async (tor: boolean): Promise<void> => {
  setTransportRoute(tor ? 'tor' : 'direct');
  if (isDesktop()) {
    const { invoke: inv } = await import('@tauri-apps/api/core');
    await inv('set_tor_enabled', { enabled: tor });
  }
};

/** Per-event provenance: the route of the exact query that returned the
 * event — not the current toggle state. Set by the desktop transport from
 * what Rust reports; browser fetches leave it unset (web shows no pill). */
const eventRoutes = new WeakMap<NostrEvent, TransportRoute>();
export const getEventRoute = (event: NostrEvent): TransportRoute | undefined =>
  eventRoutes.get(event);

/** NIP-42: signs kind 22242 auth events when a relay challenges us.
 * Wired from the current user's signer (NostrSync); unset when logged out —
 * auth-gated relays then show status "auth" instead of serving silently. */
export type AuthSigner = (challenge: string, relay: string) => Promise<NostrEvent>;
let authSigner: AuthSigner | undefined;
export const setAuthSigner = (signer: AuthSigner | undefined): void => {
  authSigner = signer;
};

export interface EgressEntry {
  kind: 'ws' | 'http' | 'query';
  url: string;
  ts: number;
  kinds?: string;
  authors?: number;
  events?: number;
  ms?: number;
  status?: 'ok' | 'empty' | 'error' | 'auth';
  /** CLOSED reason or failure text — surfaced on the debug page. */
  reason?: string;
  route?: TransportRoute;
}

/** Ring buffer of recent egress, rendered by the debug page. */
export const egressLog: EgressEntry[] = [];

export const logEgress = (kind: EgressEntry['kind'], url: string): void => {
  egressLog.unshift({ kind, url, ts: Date.now() });
  if (egressLog.length > 200) egressLog.pop();
};

export const logQuery = (url: string, kinds: number[], authors?: number): EgressEntry => {
  const entry: EgressEntry = {
    kind: 'query',
    url,
    ts: Date.now(),
    kinds: kinds.join(','),
    authors,
    status: 'ok',
    route: transportRoute,
  };
  egressLog.unshift(entry);
  if (egressLog.length > 200) egressLog.pop();
  return entry;
};

export const logQueryDone = (entry: EgressEntry, events: number, ms: number): void => {
  entry.events = events;
  entry.ms = ms;
  // 'auth'/'error' set during the run are the diagnosis — keep them.
  if (entry.status !== 'auth' && entry.status !== 'error') {
    entry.status = events > 0 ? 'ok' : 'empty';
  }
};

// ─── Tor check ────────────────────────────────────────────────────────────

// Cert-bearing https onions from independent operators, raced via any().
const ONION_PROBES = [
  'https://facebookwkhpilnemxj7asaniu7vnjjbiltxjqhye3mhbshg7kx5tfyd.onion/',
  'https://protonmailrmez3lotccpshtdeeldrid3d5xgssot65nvldisoywqtu4ad.onion/',
  'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/',
] as const;
const PROBE_TIMEOUT_MS = 25000;

/** Desktop is Tor by construction; the web build probes https onions. */
export const isTor = async (): Promise<boolean> => {
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

// ─── Relay query transport ────────────────────────────────────────────────

export interface RelayQueryOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
}

// ─── Relay IO adapters ────────────────────────────────────────────────────
// One protocol loop (runQuery) over two transports: the Tauri streaming
// bridge on desktop, a browser WebSocket on web.

export interface RelayIo {
  send: (text: string) => void;
  frames: AsyncGenerator<string>;
  close: () => void;
}

type BridgeEvent = { type: 'Frame'; data: string } | { type: 'Closed'; reason?: string };

export const openBridge = async (url: string): Promise<{ io: RelayIo; route: TransportRoute }> => {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { id, route } = await inv<{ id: number; route: TransportRoute }>('relay_stream_start', { url });

  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;
  let closed = false;
  const unlistenP = listen<BridgeEvent>(`relay://${id}`, (e) => {
    if (e.payload.type === 'Frame') queue.push(e.payload.data);
    else closed = true;
    resolveNext?.();
  });

  async function* frameGen(): AsyncGenerator<string> {
    await unlistenP; // don't miss frames before the listener attaches
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => {
        resolveNext = r;
      });
      resolveNext = null;
    }
  }

  const io: RelayIo = {
    send: (text) => {
      void inv('relay_stream_send', { id, message: text }).catch(() => {/* socket gone */});
    },
    frames: frameGen(),
    close: () => {
      closed = true;
      resolveNext?.();
      void inv('relay_stream_stop', { id }).catch(() => {/* already gone */});
      void unlistenP.then((un) => un());
    },
  };
  return { io, route };
};

const openBrowser = (url: string): RelayIo => {
  logEgress('ws', url);
  const ws = new WebSocket(url);
  const queue: string[] = [];
  const pendingSends: string[] = []; // buffered until the socket opens
  let resolveNext: (() => void) | null = null;
  let closed = false;

  async function* frameGen(): AsyncGenerator<string> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => {
        resolveNext = r;
      });
      resolveNext = null;
    }
  }

  ws.onopen = () => {
    for (const text of pendingSends.splice(0)) ws.send(text);
  };
  ws.onmessage = (m) => {
    queue.push(m.data as string);
    resolveNext?.();
  };
  ws.onclose = () => {
    closed = true;
    resolveNext?.();
  };
  ws.onerror = () => {
    closed = true;
    resolveNext?.();
  };

  return {
    send: (text) => {
      if (ws.readyState === WebSocket.CONNECTING) pendingSends.push(text);
      else ws.send(text);
    },
    frames: frameGen(),
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
};

// ─── NIP-01 REQ loop with NIP-42 AUTH ────────────────────────────────────

let subSeq = 0;

/** Protocol loop shared by both transports: REQ → EVENT* → EOSE|CLOSED,
 * answering AUTH challenges (kind 22242 via the module auth signer) and
 * re-sending the REQ once authenticated. */
const runQuery = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts,
  entry: EgressEntry,
  io: RelayIo,
): Promise<NostrEvent[]> => {
  const subId = `q${++subSeq}`;
  const events: NostrEvent[] = [];
  const seen = new Set<string>();
  let finished = false;
  let authed = false;

  const timer = setTimeout(() => {
    finished = true;
    resolveFrame?.();
  }, opts.timeoutMs ?? 10000);
  opts.signal?.addEventListener('abort', () => {
    finished = true;
    resolveFrame?.();
  }, { once: true });

  let resolveFrame: (() => void) | null = null;
  const sendReq = () => io.send(JSON.stringify(['REQ', subId, ...filters]));

  sendReq();

  const frames = io.frames[Symbol.asyncIterator]();
  while (!finished) {
    const next = await Promise.race([frames.next(), new Promise<never>((r) => {
      resolveFrame = () => r(undefined as never);
    })]);
    if (finished || next?.done) break;
    let frame: unknown;
    try {
      frame = JSON.parse(next.value);
    } catch {
      continue;
    }
    const [type, a, b] = frame as [string, string, unknown];

    if (type === 'EVENT' && a === subId) {
      const event = b as NostrEvent;
      if (!seen.has(event.id)) {
        try {
          if (nostrVerifyEvent(event)) {
            seen.add(event.id);
            events.push(event);
          }
        } catch {
          // invalid event — skip
        }
      }
    } else if (type === 'EOSE' && a === subId) {
      finished = true;
    } else if (type === 'CLOSED' && a === subId) {
      const reason = typeof b === 'string' ? b : '';
      if (reason) entry.reason = reason.slice(0, 120);
      if (reason.includes('auth')) entry.status = 'auth';
      finished = true;
    } else if (type === 'NOTICE' && typeof a === 'string') {
      // Relays explain refusals via NOTICE (e.g. "auth-required") — capture
      // it so "empty" can be told apart from "refused".
      if (a) entry.reason = a.slice(0, 120);
      if (a.includes('auth') && entry.status !== 'auth') {
        entry.status = 'auth';
        finished = true;
      }
    } else if (type === 'AUTH') {
      // NIP-42 challenge: sign kind 22242, answer, re-send the REQ.
      if (authSigner && !authed) {
        authed = true;
        try {
          const authEvent = await authSigner(a, url);
          io.send(JSON.stringify(['AUTH', authEvent]));
          sendReq();
        } catch {
          entry.status = 'auth';
          entry.reason = 'auth signing failed';
          finished = true;
        }
      } else if (!authSigner) {
        entry.status = 'auth';
        entry.reason = 'relay requires auth (not logged in)';
        finished = true;
      }
    }
  }

  clearTimeout(timer);
  io.close();
  return events;
};

export const queryRelay = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const entry = logQuery(url, filters[0]?.kinds ?? [], filters[0]?.authors?.length);
  const startedAt = Date.now();

  let io: RelayIo;
  let route: TransportRoute | undefined;
  try {
    if (isDesktop()) {
      const bridge = await openBridge(url);
      io = bridge.io;
      route = bridge.route;
    } else {
      io = openBrowser(url);
    }
  } catch (e) {
    console.error(`[net] connect failed for ${url}:`, e);
    entry.status = 'error';
    entry.reason = String(e).slice(0, 120);
    logQueryDone(entry, 0, Date.now() - startedAt);
    return [];
  }

  // Rust reports the route actually used — source of truth for provenance.
  entry.route = route;
  if (route) transportRoute = route;

  let events: NostrEvent[] = [];
  try {
    events = await runQuery(url, filters, opts, entry, io);
  } catch (e) {
    entry.status = 'error';
    entry.reason = String(e).slice(0, 120);
  }
  for (const e of events) eventRoutes.set(e, route ?? 'direct');
  logQueryDone(entry, events.length, Date.now() - startedAt);
  return events;
};

// Web: open a socket, push one EVENT, read the OK, close.
const publishRelayBrowser = (url: string, event: NostrEvent): Promise<void> =>
  new Promise((resolve) => {
    logEgress('http', url);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data as string);
        if (msg[0] === 'OK' && msg[1] === event.id) {
          clearTimeout(timer);
          finish();
        }
      } catch {
        // malformed frame — wait for timer
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish();
    };
    ws.onclose = () => {
      clearTimeout(timer);
      finish();
    };
  });

/** Push one signed event to every relay. Fire-and-forget per relay:
 * one relay being down never blocks the others. */
export const publish = async (event: NostrEvent, relays: string[]): Promise<void> => {
  const push = (url: string) =>
    isDesktop()
      ? invoke<void>('relay_publish', { url, event })
      : publishRelayBrowser(url, event);
  await Promise.allSettled(relays.map(push));
};

/** Fan-out to many relays, merge + dedupe. */
export const queryRelays = async (
  urls: string[],
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const results = await Promise.all(urls.map((url) => queryRelay(url, filters, opts)));
  return [...new Map(results.flat().map((e) => [e.id, e])).values()];
};
