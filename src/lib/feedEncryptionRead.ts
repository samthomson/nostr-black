import type { NostrEvent } from '@nostrify/nostrify';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  noteIdOf,
  openConnection,
  openPrivateNote,
  openPrivateReply,
  type ConnectionRecord,
  type OpenedNote,
  type Rumor,
} from './feedEncryption';

export const tryOpenConnection = (sk: Uint8Array, event: NostrEvent): ConnectionRecord | undefined => {
  try {
    return openConnection(sk, event);
  } catch {
    return undefined;
  }
};

export const tryOpenNote = (sk: Uint8Array, event: NostrEvent): OpenedNote | undefined => {
  try {
    return openPrivateNote(sk, event);
  } catch {
    return undefined;
  }
};

export const tryOpenReply = (cek: Uint8Array, event: NostrEvent): Rumor | undefined => {
  try {
    return openPrivateReply(cek, event);
  } catch {
    return undefined;
  }
};

const groupKey = (note: OpenedNote): string =>
  `${note.rumor.pubkey}:${bytesToHex(note.replyCek)}`;

const revisionOf = (rumor: Rumor): string | undefined =>
  rumor.tags.find(([name]) => name === 'revision_of')?.[1];

/** Chunks of one publication share a rumor id; one entry per id. */
const deduped = (opened: readonly OpenedNote[]): OpenedNote[] => {
  const byRumor = new Map<string, OpenedNote>();
  for (const note of opened) {
    const existing = byRumor.get(note.rumor.id);
    if (!existing || note.rumor.created_at > existing.rumor.created_at) {
      byRumor.set(note.rumor.id, note);
    }
  }
  return [...byRumor.values()];
};

const groupsOf = (opened: readonly OpenedNote[]): Map<string, OpenedNote[]> => {
  const groups = new Map<string, OpenedNote[]>();
  for (const note of deduped(opened)) {
    const key = groupKey(note);
    const list = groups.get(key) ?? [];
    list.push(note);
    groups.set(key, list);
  }
  return groups;
};

const byNewest = (a: OpenedNote, b: OpenedNote): number =>
  b.rumor.created_at - a.rumor.created_at;

/** One note per conversation: chunks collapse, revisions keep the tip. */
export const collapseNotes = (opened: readonly OpenedNote[]): OpenedNote[] => {
  const tips: OpenedNote[] = [];
  for (const group of groupsOf(opened).values()) {
    const superseded = new Set(
      group.map((n) => revisionOf(n.rumor)).filter((id): id is string => !!id),
    );
    const heads = group.filter((n) => !superseded.has(n.rumor.id)).sort(byNewest);
    if (heads[0]) tips.push(heads[0]);
  }
  return tips.sort(byNewest);
};


/**
 * Every wrapper of one private conversation — same author, same reply
 * cek: chunks and revisions alike, each independently burner-signed.
 * Deleting a note means deleting all of them.
 */
export const conversationOf = (
  sk: Uint8Array,
  events: readonly NostrEvent[],
  note: OpenedNote,
): NostrEvent[] => {
  const key = groupKey(note);
  return events
    .map((event) => tryOpenNote(sk, event))
    .filter((opened): opened is OpenedNote => opened !== undefined && groupKey(opened) === key)
    .map((opened) => opened.wrapper);
};

export interface OpenedReply {
  rumor: Rumor;
  wrapper: NostrEvent;
  /** Superseded versions of this reply, oldest first — empty for an unedited reply. */
  history?: readonly OpenedReply[];
}

/**
 * One note's conversation events, split by role: **revisions** are the
 * author's own `revision_of` chain off the root rumor (each supersedes
 * the note for the whole audience — one event, every holder has the
 * reply CEK); **reactions** are kind-7 rumors addressed by `e` tag —
 * they never render as text replies; **replies** are everything else,
 * each carrying its own superseded versions as `history`. A
 * forged `revision_of` from another author is just their own reply,
 * never a supersede.
 */
export interface Conversation {
  /** The author's revision chain off the note, oldest first. */
  revisions: readonly OpenedReply[];
  replies: readonly OpenedReply[];
  /** Kind-7 rumors addressed into this conversation, any target. */
  reactions: readonly OpenedReply[];
}

export const conversationOn = (
  note: OpenedNote,
  events: readonly NostrEvent[],
  open: (cek: Uint8Array, event: NostrEvent) => Rumor | undefined = tryOpenReply,
): Conversation => {
  const n = noteIdOf(note.replyCek);
  const opened: OpenedReply[] = [];
  for (const event of events) {
    if (!event.tags.some(([name, value]) => name === 'n' && value === n)) continue;
    const rumor = open(note.replyCek, event);
    if (rumor) opened.push({ rumor, wrapper: event });
  }

  // Reactions are a role, not a reply: kind 7 leaves the conversation
  // before revision/reply sorting — it can never be revised or rendered
  // as text.
  const reactions = opened.filter((r) => r.rumor.kind === 7);
  const nonReactions = opened.filter((r) => r.rumor.kind !== 7);

  // The note's revision chain: same author as the note, each link's
  // revision_of pointing at the previous rumor id (root first).
  const chain: OpenedReply[] = [];
  let cursor = note.rumor.id;
  for (;;) {
    const next = nonReactions.find(
      (r) => r.rumor.pubkey === note.rumor.pubkey && revisionOf(r.rumor) === cursor,
    );
    if (!next) break;
    chain.push(next);
    cursor = next.rumor.id;
  }
  const revisionIds = new Set(chain.map((r) => r.rumor.id));

  // Replies: everything else. An author's revision supersedes their own
  // earlier reply — never anyone else's. Each tip carries the superseded
  // versions as its history, oldest first.
  const rest = nonReactions.filter((r) => !revisionIds.has(r.rumor.id));
  const supersededBy = (candidate: OpenedReply): OpenedReply | undefined =>
    rest.find(
      (r) => r.rumor.pubkey === candidate.rumor.pubkey && revisionOf(r.rumor) === candidate.rumor.id,
    );
  const replies = rest
    .filter((r) => !supersededBy(r))
    .sort((a, b) => a.rumor.created_at - b.rumor.created_at)
    .map((tip) => {
      const chain: OpenedReply[] = [];
      let cursor: OpenedReply | undefined = tip;
      while (cursor) {
        chain.unshift(cursor);
        const target = revisionOf(cursor.rumor);
        const prev = target ? rest.find((r) => r.rumor.id === target) : undefined;
        cursor = prev && prev.rumor.pubkey === tip.rumor.pubkey ? prev : undefined;
      }
      return chain.length > 1 ? { ...tip, history: chain.slice(0, -1) } : tip;
    });

  return { revisions: chain, replies, reactions };
};

export interface Reaction {
  /** Who reacted — the conversation member's real pubkey. */
  pubkey: string;
  /** The reaction itself: '+', '-', or an emoji. */
  content: string;
  /** The reaction's wrapper id — the delete target for toggling off. */
  id: string;
  created_at: number;
}

/**
 * The reactions addressed at one item, deduped the NIP-25 way: one
 * person, many kind 7s — the reader cares about people, so an author's
 * latest reaction is the one that counts.
 */
export const reactionsTo = (conversation: Conversation, targetId: string): readonly Reaction[] => {
  const mine = conversation.reactions.filter(
    (r) => r.rumor.tags.find(([name]) => name === 'e')?.[1] === targetId,
  );
  const latest = new Map<string, OpenedReply>();
  for (const r of mine) {
    const held = latest.get(r.rumor.pubkey);
    if (!held || r.rumor.created_at >= held.rumor.created_at) latest.set(r.rumor.pubkey, r);
  }
  return [...latest.values()]
    .sort((a, b) => b.rumor.created_at - a.rumor.created_at)
    .map((r) => ({ id: r.wrapper.id, pubkey: r.rumor.pubkey, content: r.rumor.content, created_at: r.rumor.created_at }));
};
