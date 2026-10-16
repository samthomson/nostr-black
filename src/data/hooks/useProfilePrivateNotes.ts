import { useCallback, useRef, useSyncExternalStore } from 'react';
import { bytesToHex } from '@noble/hashes/utils.js';
import { store } from '@/data/store';
import { KIND_PRIVATE_NOTE, aliasOf, type OpenedNote } from '@/lib/feedEncryption';
import { tryOpenNote } from '@/lib/feedEncryptionRead';
import { isPending, useEntity } from './useEntity';
import { useSessionKey } from './useSessionKey';
import { useConnections } from './useConnections';

const EMPTY: OpenedNote[] = [];

const sameIds = (a: readonly OpenedNote[], b: readonly OpenedNote[]): boolean =>
  a.length === b.length && a.every((note, i) => note.wrapper.id === b[i].wrapper.id);

/** Opened notes cached per event id, reset when the session key changes. */
interface DecryptCache {
  sk: string;
  notes: Map<string, OpenedNote>;
}

/**
 * A connected peer's private notes, opened with our session key — shown
 * on their profile, mixed with their public notes. Non-connected profiles
 * have nothing here: their sealed notes can't be opened, and asking for
 * the alias would be a pointless query.
 */
export const useProfilePrivateNotes = (pubkey: string | undefined) => {
  const sk = useSessionKey();
  const { connected } = useConnections();
  const isConnected = !!sk && !!pubkey && connected.some((r) => r.peer === pubkey);
  const alias = sk && pubkey ? aliasOf(sk, pubkey) : undefined;

  const settle = useEntity(
    sk && isConnected && alias && pubkey ? { type: 'privateNotes', aliases: [alias], peers: [pubkey] } : undefined,
    'interactive',
  );

  const decryptCache = useRef<DecryptCache>({ sk: '', notes: new Map() });
  const cache = useRef<OpenedNote[]>([]);
  const subscribe = useCallback(
    (onChange: () => void) => store.watch({ onIngest: () => onChange(), onClear: () => onChange() }),
    [],
  );
  const snapshot = useCallback((): OpenedNote[] => {
    if (!sk || !pubkey) return EMPTY;
    const sessionKey = bytesToHex(sk);
    if (decryptCache.current.sk !== sessionKey) {
      decryptCache.current = { sk: sessionKey, notes: new Map() };
    }
    const dc = decryptCache.current;
    const next = store
      .queryByKind(KIND_PRIVATE_NOTE)
      .map((event) => {
        const cached = dc.notes.get(event.id);
        if (cached) return cached;
        const opened = tryOpenNote(sk, event);
        if (opened) dc.notes.set(event.id, opened);
        return opened;
      })
      .filter((note): note is OpenedNote => note !== undefined && note.rumor.pubkey === pubkey)
      .sort((a, b) => b.rumor.created_at - a.rumor.created_at);
    if (sameIds(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [sk, pubkey]);

  const notes = useSyncExternalStore(subscribe, snapshot, snapshot);

  return { notes, pending: !!pubkey && isConnected && isPending(settle) };
};
