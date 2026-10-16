import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { bytesToHex } from '@noble/hashes/utils.js';
import { store } from '@/data/store';
import {
  KIND_PRIVATE_NOTE,
  KIND_PRIVATE_REPLY,
  aliasOf,
  noteIdOf,
  type OpenedNote,
} from '@/lib/feedEncryption';
import {
  collapseNotes,
  conversationOn,
  tryOpenNote,
  tryOpenReply,
  type OpenedReply,
} from '@/lib/feedEncryptionRead';
import type { PrivatePost } from './usePrivateFeed';
import { isPending, useEntity } from './useEntity';
import { useSessionKey } from './useSessionKey';
import { useConnections } from './useConnections';

const EMPTY: PrivatePost[] = [];

const sameIds = (a: readonly PrivatePost[], b: readonly PrivatePost[]): boolean =>
  a.length === b.length && a.every((post, i) =>
    post.note.wrapper.id === b[i].note.wrapper.id
    && post.replies.length === b[i].replies.length
    && post.replies.every((r, j) => r.wrapper.id === b[i].replies[j].wrapper.id)
    && post.conversation.reactions.length === b[i].conversation.reactions.length
    && post.conversation.reactions.every((r, j) => r.wrapper.id === b[i].conversation.reactions[j].wrapper.id));

/** Opened notes and replies cached per event id, reset per session key. */
interface DecryptCache {
  sk: string;
  notes: Map<string, OpenedNote>;
  replies: Map<string, OpenedReply>;
}

/**
 * A connected peer's private posts with full conversations — the same
 * `PrivatePost` shape the private feed renders, filtered to one author —
 * shown on their profile, mixed with their public notes. Non-connected
 * profiles have nothing here: their sealed notes can't be opened, and
 * asking for the alias would be a pointless query.
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

  const decryptCache = useRef<DecryptCache>({ sk: '', notes: new Map(), replies: new Map() });
  const cache = useRef<PrivatePost[]>([]);
  const subscribe = useCallback(
    (onChange: () => void) => store.watch({ onIngest: () => onChange(), onClear: () => onChange() }),
    [],
  );
  const snapshot = useCallback((): PrivatePost[] => {
    if (!sk || !pubkey) return EMPTY;
    const sessionKey = bytesToHex(sk);
    if (decryptCache.current.sk !== sessionKey) {
      decryptCache.current = { sk: sessionKey, notes: new Map(), replies: new Map() };
    }
    const dc = decryptCache.current;
    // Only the peer's own notes — revisions and replies from either party
    const open = (event: Parameters<typeof tryOpenNote>[1]): OpenedNote | undefined => {
      const cached = dc.notes.get(event.id);
      if (cached) return cached;
      const note = tryOpenNote(sk, event);
      if (note) dc.notes.set(event.id, note);
      return note;
    };
    const notes = collapseNotes(
      store.queryByKind(KIND_PRIVATE_NOTE)
        .map(open)
        .filter((note): note is OpenedNote => note !== undefined && note.rumor.pubkey === pubkey),
    );
    const conversationEvents = store.queryByKind(KIND_PRIVATE_REPLY);
    const next = notes.map((note) => {
      const conversation = conversationOn(note, conversationEvents, (cek, event) => {
        const cached = dc.replies.get(event.id);
        if (cached) return cached.rumor;
        const rumor = tryOpenReply(cek, event);
        if (rumor) dc.replies.set(event.id, { rumor, wrapper: event });
        return rumor;
      });
      // Assemble the feed shape: tip renders, superseded versions are
      // history, replies hang underneath.
      const revisions = conversation.revisions.map((revision) => ({ ...note, wrapper: revision.wrapper, rumor: revision.rumor }));
      const tip = revisions.at(-1);
      return {
        note: tip ?? note,
        history: tip ? [note, ...revisions] : [],
        replies: conversation.replies,
        conversation,
      };
    });

    if (sameIds(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [sk, pubkey]);
  const posts = useSyncExternalStore(subscribe, snapshot, snapshot);

  // The reply/reaction events hang off each note's channel; without this
  // want the conversations stay empty (the feed page issues its own).
  const noteIds = useMemo(
    () => [...new Set(posts.map((post) => noteIdOf(post.note.replyCek)))],
    [posts],
  );
  const repliesSettle = useEntity(
    noteIds.length > 0 && pubkey ? { type: 'privateReplies', noteIds, peers: [pubkey] } : undefined,
    'interactive',
  );

  return {
    posts,
    pending: !!pubkey && isConnected && (isPending(settle) || (noteIds.length > 0 && isPending(repliesSettle))),
  };
};
