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
}

/**
 * One note's conversation events, split by role: **revisions** are the
 * author's own `revision_of` chain off the root rumor (each supersedes
 * the note for the whole audience — one event, every holder has the
 * reply CEK); **replies** are everything else, with the author's reply
 * revisions collapsed per `repliesOn` rules. A forged `revision_of`
 * from another author is just their own reply, never a supersede.
 */
export interface Conversation {
  /** The author's revision chain off the note, oldest first. */
  revisions: readonly OpenedReply[];
  replies: readonly OpenedReply[];
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

  // The note's revision chain: same author as the note, each link's
  // revision_of pointing at the previous rumor id (root first).
  const chain: OpenedReply[] = [];
  let cursor = note.rumor.id;
  for (;;) {
    const next = opened.find(
      (r) => r.rumor.pubkey === note.rumor.pubkey && revisionOf(r.rumor) === cursor,
    );
    if (!next) break;
    chain.push(next);
    cursor = next.rumor.id;
  }
  const revisionIds = new Set(chain.map((r) => r.rumor.id));

  // Replies: everything else. An author's revision supersedes their own
  // earlier reply — never anyone else's.
  const rest = opened.filter((r) => !revisionIds.has(r.rumor.id));
  const superseded = new Set<string>();
  for (const reply of rest) {
    const target = revisionOf(reply.rumor);
    if (!target) continue;
    const parentReply = rest.find((r) => r.rumor.id === target);
    if (parentReply && parentReply.rumor.pubkey === reply.rumor.pubkey) superseded.add(target);
  }
  const replies = rest
    .filter((reply) => !superseded.has(reply.rumor.id))
    .sort((a, b) => a.rumor.created_at - b.rumor.created_at);

  return { revisions: chain, replies };
};
