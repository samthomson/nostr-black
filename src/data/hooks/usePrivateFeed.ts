import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { bytesToHex } from '@noble/hashes/utils.js';
import { store } from '@/data/store';
import { KIND_PRIVATE_NOTE, KIND_PRIVATE_REPLY, aliasOf, noteIdOf, type OpenedNote, type Rumor } from '@/lib/feedEncryption';
import { collapseNotes, conversationOn, tryOpenNote, tryOpenReply, type OpenedReply } from '@/lib/feedEncryptionRead';
import { isPending, useEntity } from './useEntity';
import { useConnections } from './useConnections';
import { useSessionKey } from './useSessionKey';
import { getPublicKey } from 'nostr-tools';

export interface PrivatePost {
  note: OpenedNote;
  /** The note's superseded revisions — its edit history. */
  history: readonly OpenedNote[];
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
    && post.history.length === b[i].history.length
    && post.history.every((rev, j) => rev.wrapper.id === b[i].history[j].wrapper.id)
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

  // Connection aliases plus the self-alias: the same #f query that feeds
  // the page also fetches everything the user authored — the archive is
  // identity-derived, no device-local state.
  const withSelf = useMemo(
    () => (sk ? [...aliases, aliasOf(sk, getPublicKey(sk))] : aliases),
    [aliases, sk],
  );

  const notesSettle = useEntity(
    withSelf.length > 0 ? { type: 'privateNotes', aliases: withSelf, peers } : undefined,
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

    const openedNotes = store.queryByKind(KIND_PRIVATE_NOTE)
      .map(openNote)
      .filter((note): note is OpenedNote => note !== undefined);
    const notes = collapseNotes(openedNotes);
    const replyEvents = store.queryByKind(KIND_PRIVATE_REPLY);
    const next = notes.map((note) => {
      const conversation = conversationOn(note, replyEvents, openReply);
      // The tip of the revision chain is what renders; everything it
      // superseded — the original included — is history.
      const tip = conversation.revisions.at(-1);
      const shown = tip
        ? { ...note, wrapper: tip.wrapper, rumor: tip.rumor }
        : note;
      return {
        note: shown,
        // With a tip, the original plus every intermediate revision is
        // history, oldest first.
        history: tip
          ? [note, ...conversation.revisions.map((r) => ({ ...note, wrapper: r.wrapper, rumor: r.rumor }))]
          : [],
        replies: conversation.replies,
      };
    });
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
