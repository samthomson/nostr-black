/**
 * Egress boundary — every network request in this app goes through this module.
 * Nothing outside `src/net` may call `fetch` or construct a `WebSocket`
 * directly (see AGENTS.md, privacy doctrine).
 *
 * This is the browser implementation: direct connections, used behind the
 * Tor gate. The Tauri desktop build replaces the transports with Rust-backed
 * ones that route through the bundled Tor (arti SOCKS5) — same functions,
 * different transport.
 */

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
 * One mechanism: probe an .onion that serves valid https. Only Tor can route
 * onion addresses, so a settled response means Tor; any failure (DNS, TLS,
 * timeout) means not confirmed. The https requirement matters: an https page
 * may not fetch http (mixed content), and a cert-bearing onion can't be
 * faked by DNS hijackers. Zero third parties, no API, always live.
 */
// Cert-bearing https onions from independent operators, raced via any():
// no single party rotating/retiring their onion can break the check, and the
// onions learn nothing (Tor strips the IP; they only see "someone probed").
const ONION_PROBES = [
  // Facebook (DigiCert EV)
  'https://facebookwkhpilnemxj7asaniu7vnjjbiltxjqhye3mhbshg7kx5tfyd.onion/',
  // Proton Mail (EV)
  'https://protonmailrmez3lotccpshtdeeldrid3d5xgssot65nvldisoywqtu4ad.onion/',
  // DuckDuckGo (DV)
  'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/',
] as const;
// Cold onion connections (new circuit: guard + rendezvous + intro) can take
// well over 8s in Tor Browser — too short reads as "not on tor".
const PROBE_TIMEOUT_MS = 25000;

export const isTor = async (): Promise<boolean> => {
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
