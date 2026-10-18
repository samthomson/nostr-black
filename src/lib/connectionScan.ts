import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { queryRelay } from '@/net/net';
import { connAddrOf } from './falseBottom';
import { KIND_CONNECTION } from './feedEncryption';
import { tryOpenConnection } from './feedEncryptionRead';
import type { ConnectionRecord } from './feedEncryption';

/**
 * One follow's offer, checked at their own outbox. Their write relays are
 * asked for kind 30378 tagged `#d = conn_addr(my sk, them)` — an address
 * only derivable from our session key, so the query itself leaks nothing
 * about us beyond "someone with this address asked" (and it is our relays
 * that ask, through our own egress).
 */
export const scanFollowForOffer = async (
  sk: Uint8Array,
  follow: string,
  authorWrite: readonly string[],
): Promise<ConnectionRecord | undefined> => {
  if (authorWrite.length === 0) return undefined;
  const filter: NostrFilter = {
    kinds: [KIND_CONNECTION],
    '#d': [connAddrOf(sk, follow)],
    limit: 1,
  };
  // Races are not needed: relays are few, and one offer is all we want.
  for (const url of authorWrite) {
    const events = await queryRelay(url, [filter], { timeoutMs: 8_000 });
    const opened = events
      .map((event) => tryOpenConnection(sk, event))
      .find((record): record is ConnectionRecord =>
        record !== undefined && record.state === 'request' && record.peer === follow);
    if (opened) return opened;
  }
  return undefined;
};

/** Scan every follow; results land as they resolve. `onFound` gets each
 * new record — the caller ingests it so the whole app sees the graph. */
export const scanFollowsForOffers = async (
  sk: Uint8Array,
  follows: readonly { pubkey: string; write: readonly string[] }[],
  onFound: (record: ConnectionRecord, event: NostrEvent, from: string) => void,
  signal?: AbortSignal,
): Promise<void> => {
  await Promise.all(follows.map(async ({ pubkey, write }) => {
    if (signal?.aborted) return;
    const record = await scanFollowForOffer(sk, pubkey, write).catch(() => undefined);
    if (record && !signal?.aborted) onFound(record, record.event, write[0] ?? '');
  }));
};
