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

/**
 * Opens a relay websocket through the active egress transport.
 * Swap point for the Tauri/Tor transport; also the test seam for mocks.
 */
export const wsConnect = (url: string): WebSocket => new WebSocket(url);

/**
 * Performs an HTTP request through the active egress transport.
 * Used for media fetches and any non-relay HTTP. Swap point for Tor routing.
 */
export const httpEgress: typeof fetch = (input, init) =>
  fetch(input, { ...init, referrerPolicy: 'no-referrer' });

/**
 * Client-side Tor check for the web build (desktop is Tor-by-construction).
 * Calls the Tor Project's API: when the user is NOT on Tor this reveals
 * their IP + this origin to the Tor Project — accepted tradeoff, it happens
 * before any nostr activity and gates the app.
 */
export const isTor = async (): Promise<boolean> => {
  const res = await fetch('https://check.torproject.org/api/ip', {
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error(`Tor check failed: ${res.status}`);
  const data = (await res.json()) as { IsTor: boolean };
  return data.IsTor;
};
