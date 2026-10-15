import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';
import { store } from '@/data/store';
import { KIND_PRIVATE_NOTE, KIND_PRIVATE_REPLY, aliasOf, noteIdOf, type OpenedNote, type Rumor } from '@/lib/feedEncryption';
import {
  collapseNotes,
  conversationOn,
  tryOpenNote,
  tryOpenReply,
  type Conversation,
  type OpenedReply,
} from '@/lib/feedEncryptionRead';
import { isPending, useEntity } from './useEntity';
import { useConnections } from './useConnections';
import { useSessionKey } from './useSessionKey';

export interface PrivatePost {
  note: OpenedNote;
  /** The note's superseded versions — its edit history, oldest first. */
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

/** Decrypted notes and rumors, cached per event id — immutable once
 * opened, so each event decrypts once per session key. Memory only. */
interface DecryptCache {
  sk: string;
  notes: Map<string, OpenedNote>;
  replies: Map<string, Rumor>;
}

const openNoteCached = (cache: DecryptCache, sk: Uint8Array, event: NostrEvent): OpenedNote | undefined => {
  const hit = cache.notes.get(event.id);
  if (hit) return hit;
  const opened = tryOpenNote(sk, event);
  if (opened) cache.notes.set(event.id, opened);
  return opened;
};

const openReplyCached = (cache: DecryptCache, cek: Uint8Array, event: NostrEvent): Rumor | undefined => {
  const key = `${bytesToHex(cek)}:${event.id}`;
  const hit = cache.replies.get(key);
  if (hit) return hit;
  const rumor = tryOpenReply(cek, event);
  if (rumor) cache.replies.set(key, rumor);
  return rumor;
};

/** Assemble one feed post from a note and its conversation: the tip of
 * the author's revision chain renders; every superseded version — the
 * original included — becomes history; replies hang underneath. */
const postFrom = (note: OpenedNote, conversation: Conversation): PrivatePost => {
  const asVersion = (revision: OpenedReply): OpenedNote =>
    ({ ...note, wrapper: revision.wrapper, rumor: revision.rumor });
  const revisions = conversation.revisions.map(asVersion);
  const tip = revisions.at(-1);
  return {
    note: tip ?? note,
    history: tip ? [note, ...revisions] : [],
    replies: conversation.replies,
  };
};

/**
 * The private feed. The snapshot decrypts whatever the store holds;
 * conversation events split into the author's revisions (tip renders)
 * and replies. On-disk persistence keeps only the encrypted wrappers.
 */
export const usePrivateFeed = (): PrivateFeed => {
  const sk = useSessionKey();
  const { aliases, connected, pending: connectionsPending } = useConnections();

  const connectedPeers = useMemo(() => connected.map((r) => r.peer), [connected]);

  // Connection aliases plus the self-alias, so the one #f query that
  // feeds the page also fetches everything the user authored — the
  // archive is identity-derived, with no device-local state.
  const discoveryAliases = useMemo(
    () => (sk ? [...aliases, aliasOf(sk, getPublicKey(sk))] : aliases),
    [aliases, sk],
  );

  const notesSettle = useEntity(
    discoveryAliases.length > 0 ? { type: 'privateNotes', aliases: discoveryAliases, peers: connectedPeers } : undefined,
    'interactive',
  );

  const decryptCache = useRef<DecryptCache>({ sk: '', notes: new Map(), replies: new Map() });
  const postsCache = useRef<PrivatePost[]>([]);

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
    const sessionKey = bytesToHex(sk);
    if (decryptCache.current.sk !== sessionKey) {
      decryptCache.current = { sk: sessionKey, notes: new Map(), replies: new Map() };
    }
    const cache = decryptCache.current;

    const notes = collapseNotes(
      store.queryByKind(KIND_PRIVATE_NOTE)
        .map((event) => openNoteCached(cache, sk, event))
        .filter((note): note is OpenedNote => note !== undefined),
    );
    const conversationEvents = store.queryByKind(KIND_PRIVATE_REPLY);
    const next = notes.map((note) =>
      postFrom(note, conversationOn(note, conversationEvents, (cek, event) => openReplyCached(cache, cek, event))));

    if (samePosts(postsCache.current, next)) return postsCache.current;
    postsCache.current = next;
    return next;
  }, [sk]);

  const posts = useSyncExternalStore(subscribe, snapshot, snapshot);

  const noteIds = useMemo(
    () => [...new Set(posts.map((post) => noteIdOf(post.note.replyCek)))],
    [posts],
  );

  const repliesSettle = useEntity(
    noteIds.length > 0 ? { type: 'privateReplies', noteIds, peers: connectedPeers } : undefined,
    'interactive',
  );

  return {
    posts,
    pending: !!sk && (connectionsPending || (discoveryAliases.length > 0 && isPending(notesSettle)) || (noteIds.length > 0 && isPending(repliesSettle))),
    connectedPeers,
  };
};
