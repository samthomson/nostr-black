import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { getPublicKey } from 'nostr-tools';
import { store } from '@/data/store';
import { KIND_CONNECTION, aliasOf, connAddrOf, derivedIdentityIdOf, type ConnectionRecord } from '@/lib/feedEncryption';
import { tryOpenConnection } from '@/lib/feedEncryptionRead';
import { isPending, useEntity } from './useEntity';
import { useSessionKey } from './useSessionKey';

const EMPTY_RECORDS: ConnectionRecord[] = [];

const latestByPeer = (sk: Uint8Array): ConnectionRecord[] => {
  const byPeer = new Map<string, ConnectionRecord>();
  for (const event of store.queryByKind(KIND_CONNECTION)) {
    const record = tryOpenConnection(sk, event);
    if (!record) continue;
    const existing = byPeer.get(record.peer);
    if (!existing || record.event.created_at > existing.event.created_at) {
      byPeer.set(record.peer, record);
    }
  }
  return [...byPeer.values()].sort((a, b) => b.event.created_at - a.event.created_at);
};

const sameRecords = (a: readonly ConnectionRecord[], b: readonly ConnectionRecord[]): boolean =>
  a.length === b.length && a.every((record, i) => record.event.id === b[i].event.id);

export interface Connections {
  records: readonly ConnectionRecord[];
  connected: readonly ConnectionRecord[];
  outgoing: readonly ConnectionRecord[];
  incoming: readonly ConnectionRecord[];
  pending: boolean;
  aliases: readonly string[];
}

export const useConnections = (offerPeer?: string): Connections => {
  const sk = useSessionKey();
  const me = sk ? getPublicKey(sk) : undefined;
  const derivedIdentityId = sk ? derivedIdentityIdOf(sk) : undefined;
  const offerD = sk && offerPeer ? connAddrOf(sk, offerPeer) : undefined;

  const graph = useEntity(
    derivedIdentityId ? { type: 'connections', derivedIdentityId } : undefined,
    'interactive',
  );
  const offer = useEntity(
    offerD && offerPeer ? { type: 'connectionOffer', d: offerD, offerer: offerPeer } : undefined,
    'interactive',
  );

  const cache = useRef<ConnectionRecord[]>([]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.watch({
        onIngest: () => onChange(),
        onClear: () => onChange(),
      }),
    [],
  );

  const snapshot = useCallback((): ConnectionRecord[] => {
    if (!sk) return EMPTY_RECORDS;
    const next = latestByPeer(sk);
    if (sameRecords(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [sk]);

  const records = useSyncExternalStore(subscribe, snapshot, snapshot);

  const connected = useMemo(() => records.filter((r) => r.state === 'connected'), [records]);
  const outgoing = useMemo(
    () => records.filter((r) => r.state === 'request' && r.payload.sigs.some((s) => s.pk === me)),
    [records, me],
  );
  const incoming = useMemo(
    () => records.filter((r) => r.state === 'request' && !r.payload.sigs.some((s) => s.pk === me)),
    [records, me],
  );
  // Every relationship we have ever had, closed included: connection
  // records are durable, and conversation membership is fixed at note
  // creation — a note's chunks stay discoverable (and revisable) even
  // after the author and a recipient disconnect.
  const aliases = useMemo(
    () => (sk ? records.map((r) => aliasOf(sk, r.peer)) : []),
    [sk, records],
  );

  return {
    records,
    connected,
    outgoing,
    incoming,
    pending: !!sk && (isPending(graph) || (!!offerD && isPending(offer))),
    aliases,
  };
};
