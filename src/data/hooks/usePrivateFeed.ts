import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { bytesToHex } from '@noble/hashes/utils.js';
import { store } from '@/data/store';
import { KIND_PRIVATE_NOTE, KIND_PRIVATE_REPLY, noteIdOf, type OpenedNote, type Rumor } from '@/lib/fe';
import { collapseNotes, repliesOn, tryOpenNote, tryOpenReply, type OpenedReply } from '@/lib/feRead';
import { isPending, useEntity } from './useEntity';
import { useConnections } from './useConnections';
import { useSessionKey } from './useSessionKey';

export interface PrivatePost {
  note: OpenedNote;
  replies: readonly OpenedReply[];
}

export interface PrivateFeed {
  posts: readonly PrivatePost[];
  pending: boolean;
  connectedPeers: readonly string[];
}

const EMPTY_POSTS: PrivatePost[] = [];

const samePosts = (a: readonly PrivatePost[], b: readonly PrivatePost[]): boolean =>
  a.length === b.length && a.every((post, i) =>
    post.note.wrapper.id === b[i].note.wrapper.id
    && post.replies.length === b[i].replies.length
    && post.replies.every((reply, j) => reply.wrapper.id === b[i].replies[j].wrapper.id));

/**
 * The private feed. The snapshot decrypts whatever the store holds; opened
 * notes are immutable, so they are cached per event id — memory only, the
 * on-disk cache keeps just the encrypted wrappers.
 */
export const usePrivateFeed = (): PrivateFeed => {
  const sk = useSessionKey();
  const { aliases, connected, pending: connectionsPending } = useConnections();

  const peers = useMemo(() => connected.map((r) => r.peer), [connected]);

  const notesSettle = useEntity(
    aliases.length > 0 ? { type: 'privateNotes', aliases, peers } : undefined,
    'interactive',
  );

  const opened = useRef<{ sk: string; notes: Map<string, OpenedNote>; replies: Map<string, Rumor> }>({
    sk: '',
    notes: new Map(),
    replies: new Map(),
  });
  const cache = useRef<PrivatePost[]>([]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.watch({
        onIngest: () => onChange(),
        onClear: () => onChange(),
      }),
    [],
  );

  const snapshot = useCallback((): PrivatePost[] => {
    if (!sk) return EMPTY_POSTS;
    const skKey = bytesToHex(sk);
    if (opened.current.sk !== skKey) {
      opened.current = { sk: skKey, notes: new Map(), replies: new Map() };
    }
    const decrypted = opened.current;
    const openNote = (event: Parameters<typeof tryOpenNote>[1]): OpenedNote | undefined => {
      const hit = decrypted.notes.get(event.id);
      if (hit) return hit;
      const note = tryOpenNote(sk, event);
      if (note) decrypted.notes.set(event.id, note);
      return note;
    };
    const openReply = (cek: Parameters<typeof tryOpenReply>[0], event: Parameters<typeof tryOpenReply>[1]) => {
      const key = `${bytesToHex(cek)}:${event.id}`;
      const hit = decrypted.replies.get(key);
      if (hit) return hit;
      const rumor = tryOpenReply(cek, event);
      if (rumor) decrypted.replies.set(key, rumor);
      return rumor;
    };

    const notes = collapseNotes(
      store.queryByKind(KIND_PRIVATE_NOTE)
        .map(openNote)
        .filter((note): note is OpenedNote => note !== undefined),
    );
    const replyEvents = store.queryByKind(KIND_PRIVATE_REPLY);
    const next = notes.map((note) => ({ note, replies: repliesOn(note, replyEvents, openReply) }));
    if (samePosts(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [sk]);

  const posts = useSyncExternalStore(subscribe, snapshot, snapshot);

  const noteIds = useMemo(
    () => [...new Set(posts.map((post) => noteIdOf(post.note.replyCek)))],
    [posts],
  );

  const repliesSettle = useEntity(
    noteIds.length > 0 ? { type: 'privateReplies', noteIds, peers } : undefined,
    'interactive',
  );

  const connectedPeers = useMemo(() => connected.map((r) => r.peer), [connected]);

  return {
    posts,
    pending: !!sk && (connectionsPending || (aliases.length > 0 && isPending(notesSettle)) || (noteIds.length > 0 && isPending(repliesSettle))),
    connectedPeers,
  };
};
