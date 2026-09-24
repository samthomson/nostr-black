/**
 * Egress boundary — every network request in this app goes through this module.
 * Nothing outside `src/net` may call `fetch` or construct a `WebSocket`
 * directly (see AGENTS.md, privacy doctrine).
 *
 * This is the browser implementation: direct connections, used for dev and
 * for the web build behind the IsTor gate. The Tauri desktop build replaces
 * the transports with Rust-backed ones that route through the bundled Tor
 * (arti SOCKS5) — same functions, different transport.
 */

import torExits from './tor-exits.json';

const exitSet = new Set<string>(torExits);

export interface EgressEntry {
  kind: 'ws' | 'http';
  url: string;
  ts: number;
}

/** Ring buffer of recent egress, rendered by the debug panel (?debug=1). */
export const egressLog: EgressEntry[] = [];

export const logEgress = (kind: EgressEntry['kind'], url: string): void => {
  egressLog.unshift({ kind, url, ts: Date.now() });
  if (egressLog.length > 100) egressLog.pop();
};

/**
 * Opens a relay websocket through the active egress transport.
 * Swap point for the Tauri/Tor transport; also the test seam for mocks.
 */
export const wsConnect = (url: string): WebSocket => {
  logEgress('ws', url);
  return new WebSocket(url);
};

/**
 * Performs an HTTP request through the active egress transport.
 * Used for media fetches and any non-relay HTTP. Swap point for Tor routing.
 */
export const httpEgress: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  logEgress('http', url);
  return fetch(input, { ...init, referrerPolicy: 'no-referrer' });
};

/**
 * Client-side Tor check for the web build (desktop is Tor-by-construction).
 *
 * Primary: probe a Tor Project .onion — only Tor can resolve/answer onion
 * addresses, so a settled response (any status, opaque body) means Tor. A
 * hard network failure means no Tor. Zero third parties, always live.
 *
 * Fallback (probe times out — slow circuit, indeterminate): CORS-enabled IP
 * echo (sees the IP + this origin, before any nostr activity) compared
 * against the build-time exit list. Known edge: a network that fakes onion
 * answers reads as "on tor" — rare; the gate is overridable anyway.
 */
const ONION_PROBE = 'http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/';
const PROBE_TIMEOUT_MS = 8000;

export const isTor = async (): Promise<boolean> => {
  try {
    await fetch(ONION_PROBE, {
      mode: 'no-cors',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return true;
  } catch (e) {
    const timedOut =
      e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (!timedOut) return false;
  }

  const res = await fetch('https://api.ipify.org?format=json', {
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error(`IP echo failed: ${res.status}`);
  const { ip } = (await res.json()) as { ip: string };
  return exitSet.has(ip);
};
