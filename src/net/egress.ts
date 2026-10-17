/**
 * Egress bookkeeping: transport route, per-event provenance, the NIP-42
 * signer, and the debug ring buffer. No network calls live here — this is
 * what the rest of `src/net` records *about* them.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { isDesktop } from './runtime';

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
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_tor_enabled', { enabled: tor });
  }
};

/** Per-event provenance: the route of the exact query that returned the
 * event — not the current toggle state. Set by the desktop transport from
 * what Rust reports; browser fetches leave it unset (web shows no pill). */
const eventRoutes = new WeakMap<NostrEvent, TransportRoute>();
export const setEventRoute = (event: NostrEvent, route: TransportRoute): void => {
  eventRoutes.set(event, route);
};
export const getEventRoute = (event: NostrEvent): TransportRoute | undefined =>
  eventRoutes.get(event);

/** NIP-42: signs kind 22242 auth events when a relay challenges us.
 * Wired from the current user's signer (NostrSync); unset when logged out —
 * auth-gated relays then show status "auth" instead of serving silently. */
export type AuthSigner = (challenge: string, relay: string) => Promise<NostrEvent>;
let authSigner: AuthSigner | undefined;

/** Notified when the signing identity changes — see pool.ts. */
const authListeners = new Set<() => void>();
export const onAuthSignerChange = (listener: () => void): void => {
  authListeners.add(listener);
};

export const setAuthSigner = (signer: AuthSigner | undefined): void => {
  authSigner = signer;
  for (const listener of authListeners) listener();
};
export const getAuthSigner = (): AuthSigner | undefined => authSigner;

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

const LOG_LIMIT = 200;

/** Ring buffer of recent egress, rendered by the debug page. */
export const egressLog: EgressEntry[] = [];

const record = (entry: EgressEntry): EgressEntry => {
  egressLog.unshift(entry);
  if (egressLog.length > LOG_LIMIT) egressLog.pop();
  return entry;
};

export const logEgress = (kind: EgressEntry['kind'], url: string): void => {
  record({ kind, url, ts: Date.now() });
};

export const logQuery = (url: string, kinds: number[], authors?: number): EgressEntry =>
  record({
    kind: 'query',
    url,
    ts: Date.now(),
    kinds: kinds.join(','),
    authors,
    status: 'ok',
    route: transportRoute,
  });

export const logQueryDone = (entry: EgressEntry, events: number, ms: number): void => {
  entry.events = events;
  entry.ms = ms;
  sessionEvents += events;
  sessionRelays.add(entry.url);
  // 'auth'/'error' set during the run are the diagnosis — keep them.
  if (entry.status !== 'auth' && entry.status !== 'error') {
    entry.status = events > 0 ? 'ok' : 'empty';
  }
};

let sessionEvents = 0;
const sessionRelays = new Set<string>();

/** Totals for this session — the status bar, not the ring buffer. */
export const egressSession = (): { relays: number; events: number } => ({
  relays: sessionRelays.size,
  events: sessionEvents,
});

export const resetEgressSession = (): void => {
  sessionEvents = 0;
  sessionRelays.clear();
};
