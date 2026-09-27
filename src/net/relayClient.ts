import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { verifyEvent as nostrVerifyEvent } from 'nostr-tools';
import { logQuery, logQueryDone, wsConnect } from './net';
import { queryRelay as queryRelayDesktop } from './relayClient.desktop';

export interface RelayQueryOpts {
  /** Hard cap for the whole exchange; collected events are returned on expiry. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Minimal owned relay REQ client: open, ask, collect until EOSE or timeout,
 * close. Exists because NRelay1's send path silently drops REQs issued while
 * the socket is still connecting (upstream bug we can't fix from here), which
 * intermittently hangs queries with zero frames sent. This is also the seam
 * the Tauri/Tor transport replaces.
 *
 * Events are signature-verified before being returned — relay data is
 * untrusted.
 */
const queryRelayBrowser = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  // Per-relay deadline, jumble-generous: outbox relays vary wildly in speed,
  // and cutting early loses that relay's unique events permanently.
  const { timeoutMs = 10000, signal } = opts;
  const startedAt = Date.now();
  const entry = logQuery(url, filters[0]?.kinds ?? [], filters[0]?.authors?.length);

  return new Promise<NostrEvent[]>((resolve) => {
    const events: NostrEvent[] = [];
    const seen = new Set<string>();
    let settled = false;

    const ws = wsConnect(url);

    const finish = () => {
      if (settled) return;
      settled = true;
      logQueryDone(entry, events.length, Date.now() - startedAt);
      try {
        ws.close();
      } catch {
        // already closing/closed
      }
      resolve(events);
    };

    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      finish();
    });

    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', 'q', ...filters]));
    };

    ws.onmessage = (message) => {
      try {
        const msg = JSON.parse(message.data as string) as [
          string,
          string,
          unknown,
        ];
        if (msg[0] === 'EVENT' && msg[2]) {
          const event = msg[2] as NostrEvent;
          if (seen.has(event.id)) return;
          let valid = false;
          try {
            valid = nostrVerifyEvent(event);
          } catch {
            valid = false;
          }
          if (valid) {
            seen.add(event.id);
            events.push(event);
          }
        } else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') {
          clearTimeout(timer);
          finish();
        }
      } catch {
        // not JSON or malformed frame — ignore
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
};

/** Queries several relays with the same filters and merges the results. */
const queryRelaysBrowser = async (
  urls: string[],
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const results = await Promise.all(urls.map((url) => queryRelay(url, filters, opts)));
  return [...new Map(results.flat().map((e) => [e.id, e])).values()];
};

/**
 * Transport dispatch: one name for consumers, two implementations. Desktop
 * routes through bundled Tor (Rust/arti via invoke); web uses the owned
 * browser client.
 */
export const queryRelay: typeof queryRelayBrowser = desktop
  ? queryRelayDesktop
  : queryRelayBrowser;

export const queryRelays: typeof queryRelaysBrowser = desktop
  ? (urls, filters, opts) =>
      Promise.all(urls.map((url) => queryRelayDesktop(url, filters, opts))).then((results) =>
        [...new Map(results.flat().map((e) => [e.id, e])).values()],
      )
  : queryRelaysBrowser;
