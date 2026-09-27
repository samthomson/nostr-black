import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { verifyEvent as nostrVerifyEvent } from 'nostr-tools';
import { invoke } from '@tauri-apps/api/core';
import { logQuery, logQueryDone } from './net';

export interface RelayQueryOpts {
  /** Hard cap for the whole exchange; collected events are returned on expiry. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Desktop relay query: the Rust side opens a TLS connection over arti,
 * sends REQ, collects until EOSE/deadline — same protocol as the browser
 * client, Tor-routed transport. Signature verification stays client-side:
 * relay data is untrusted regardless of transport.
 */
export const queryRelay = async (
  url: string,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const entry = logQuery(url, filters[0]?.kinds ?? [], filters[0]?.authors?.length);
  const startedAt = Date.now();

  const raw = await invoke<unknown[]>('relay_query', {
    url,
    filters,
    timeoutMs: opts.timeoutMs ?? null,
  });

  logQueryDone(entry, raw.length, Date.now() - startedAt);

  const events: NostrEvent[] = [];
  const seen = new Set<string>();
  for (const maybe of raw) {
    try {
      const event = maybe as NostrEvent;
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (nostrVerifyEvent(event)) events.push(event);
    } catch {
      // malformed — skip
    }
  }
  return events;
};

/** Merged fan-out, mirroring the browser client's queryRelays. */
export const queryRelays = async (
  urls: string[],
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  const results = await Promise.all(urls.map((url) => queryRelay(url, filters, opts)));
  return [...new Map(results.flat().map((e) => [e.id, e])).values()];
};
