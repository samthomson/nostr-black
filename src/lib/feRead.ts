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
} from './fe';

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

/** One note per conversation: chunks collapse, revisions keep the tip. */
export const collapseNotes = (opened: readonly OpenedNote[]): OpenedNote[] => {
  const byRumor = new Map<string, OpenedNote>();
  for (const note of opened) {
    const existing = byRumor.get(note.rumor.id);
    if (!existing || note.rumor.created_at > existing.rumor.created_at) {
      byRumor.set(note.rumor.id, note);
    }
  }

  const groups = new Map<string, OpenedNote[]>();
  for (const note of byRumor.values()) {
    const key = groupKey(note);
    const list = groups.get(key) ?? [];
    list.push(note);
    groups.set(key, list);
  }

  const tips: OpenedNote[] = [];
  for (const group of groups.values()) {
    const superseded = new Set(
      group
        .map((n) => n.rumor.tags.find(([name]) => name === 'revision_of')?.[1])
        .filter((id): id is string => !!id),
    );
    const heads = group
      .filter((n) => !superseded.has(n.rumor.id))
      .sort((a, b) => b.rumor.created_at - a.rumor.created_at);
    if (heads[0]) tips.push(heads[0]);
  }

  return tips.sort((a, b) => b.rumor.created_at - a.rumor.created_at);
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

export const repliesOn = (
  parent: OpenedNote,
  events: readonly NostrEvent[],
  open: (cek: Uint8Array, event: NostrEvent) => Rumor | undefined = tryOpenReply,
): OpenedReply[] => {
  const n = noteIdOf(parent.replyCek);
  const out: OpenedReply[] = [];
  for (const event of events) {
    if (!event.tags.some(([name, value]) => name === 'n' && value === n)) continue;
    const rumor = open(parent.replyCek, event);
    if (rumor) out.push({ rumor, wrapper: event });
  }
  return out.sort((a, b) => a.rumor.created_at - b.rumor.created_at);
};
