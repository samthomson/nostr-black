import { describe, expect, it } from 'vitest';
import { generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  makeRumor,
  wrapPrivateNote,
  wrapPrivateReply,
  type Rumor,
} from './feedEncryption';
import { collapseNotes, conversationOn, reactionsTo, tryOpenNote } from './feedEncryptionRead';

const pair = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

const rumorOf = (pubkey: string, content: string, tags: string[][], createdAt: number): Rumor => {
  const template = { pubkey, created_at: createdAt, kind: 1, tags, content };
  return { ...template, id: getEventHash(template) };
};

describe('collapseNotes', () => {
  it('collapses independently encrypted chunks of the same rumor', () => {
    const alice = pair();
    const bob = pair();
    const { rumor } = makeRumor(alice.pk, 'once');
    const chunks = wrapPrivateNote(alice.sk, [bob.pk], rumor);
    const opened = chunks.map((event) => tryOpenNote(bob.sk, event)!);
    expect(collapseNotes(opened)).toHaveLength(1);
    expect(collapseNotes(opened)[0].rumor.content).toBe('once');
  });

  it('keeps the tip of a revision chain', () => {
    const alice = pair();
    const bob = pair();
    const { rumor: v1, replyCek } = makeRumor(alice.pk, 'v1');
    const v2 = rumorOf(
      alice.pk,
      'v2',
      [['reply_cek', bytesToHex(replyCek)], ['revision_of', v1.id]],
      v1.created_at + 10,
    );
    const opened = [
      ...wrapPrivateNote(alice.sk, [bob.pk], v1).map((e) => tryOpenNote(bob.sk, e)!),
      ...wrapPrivateNote(alice.sk, [bob.pk], v2).map((e) => tryOpenNote(bob.sk, e)!),
    ];
    const tips = collapseNotes(opened);
    expect(tips).toHaveLength(1);
    expect(tips[0].rumor.content).toBe('v2');
  });
});

describe('conversationOn', () => {
  it("splits the author's note revisions from replies; forged revisions never supersede", () => {
    const alice = pair();
    const bob = pair();
    const eve = pair();
    const { rumor: root, replyCek } = makeRumor(alice.pk, 'root');
    const [parent] = wrapPrivateNote(alice.sk, [bob.pk, eve.pk], root);
    const opened = tryOpenNote(bob.sk, parent)!;

    // The author revises the note itself — one conversation event.
    const noteV2 = rumorOf(alice.pk, 'root v2', [['reply_cek', bytesToHex(replyCek)], ['revision_of', root.id]], root.created_at + 5);
    // bob revises his own reply; eve forges a revision_of at bob's.
    const bobV1 = rumorOf(bob.pk, 'bob v1', [['e', root.id]], root.created_at + 10);
    const bobV2 = rumorOf(bob.pk, 'bob v2', [['e', root.id], ['revision_of', bobV1.id]], root.created_at + 20);
    const eveForge = rumorOf(eve.pk, 'not a revision', [['e', root.id], ['revision_of', bobV1.id]], root.created_at + 30);
    const events = [
      wrapPrivateReply(alice.sk, replyCek, noteV2),
      wrapPrivateReply(bob.sk, replyCek, bobV1),
      wrapPrivateReply(bob.sk, replyCek, bobV2),
      wrapPrivateReply(eve.sk, replyCek, eveForge),
    ];

    const conversation = conversationOn(opened, events);
    expect(conversation.revisions.map((r) => r.rumor.content)).toEqual(['root v2']);
    expect(conversation.replies.map((r) => r.rumor.content)).toEqual(['bob v2', 'not a revision']);
  });

  it('walks multi-link revision chains off the root', () => {
    const alice = pair();
    const { rumor: root, replyCek } = makeRumor(alice.pk, 'v1');
    const [parent] = wrapPrivateNote(alice.sk, [alice.pk], root);
    const opened = tryOpenNote(alice.sk, parent)!;

    const v2 = rumorOf(alice.pk, 'v2', [['reply_cek', bytesToHex(replyCek)], ['revision_of', root.id]], root.created_at + 10);
    const v3 = rumorOf(alice.pk, 'v3', [['reply_cek', bytesToHex(replyCek)], ['revision_of', v2.id]], v2.created_at + 10);
    const conversation = conversationOn(opened, [
      wrapPrivateReply(alice.sk, replyCek, v3),
      wrapPrivateReply(alice.sk, replyCek, v2),
    ]);
    expect(conversation.revisions.map((r) => r.rumor.content)).toEqual(['v2', 'v3']);
  });
});

describe('private reactions', () => {
  it('kind-7 rumors are reactions, never text replies', () => {
    const alice = pair();
    const bob = pair();
    const { rumor: root, replyCek } = makeRumor(alice.pk, 'root');
    const [parent] = wrapPrivateNote(alice.sk, [bob.pk], root);
    const opened = tryOpenNote(bob.sk, parent)!;

    const plus = makeRumor(bob.pk, '+', [['e', root.id]], 7).rumor;
    const textReply = rumorOf(bob.pk, 'a real reply', [['e', root.id]], root.created_at + 10);
    const conversation = conversationOn(opened, [
      wrapPrivateReply(bob.sk, replyCek, plus),
      wrapPrivateReply(bob.sk, replyCek, textReply),
    ]);

    expect(conversation.replies.map((r) => r.rumor.content)).toEqual(['a real reply']);
    expect(conversation.reactions.map((r) => r.rumor.content)).toEqual(['+']);
  });

  it('reactions address their target by e tag — note or reply', () => {
    const alice = pair();
    const bob = pair();
    const { rumor: root, replyCek } = makeRumor(alice.pk, 'root');
    const [parent] = wrapPrivateNote(alice.sk, [bob.pk], root);
    const opened = tryOpenNote(bob.sk, parent)!;
    const reply = rumorOf(bob.pk, 'reply here', [['e', root.id]], root.created_at + 10);

    const conversation = conversationOn(opened, [
      wrapPrivateReply(bob.sk, replyCek, makeRumor(bob.pk, '+', [['e', root.id]], 7).rumor),
      wrapPrivateReply(alice.sk, replyCek, makeRumor(alice.pk, '❤', [['e', reply.id]], 7).rumor),
    ]);

    expect(reactionsTo(conversation, root.id)).toHaveLength(1);
    expect(reactionsTo(conversation, root.id)[0].content).toBe('+');
    expect(reactionsTo(conversation, reply.id)).toHaveLength(1);
    expect(reactionsTo(conversation, reply.id)[0].content).toBe('❤');
  });

  it("one person's latest reaction is the one that counts", () => {
    const alice = pair();
    const bob = pair();
    const { rumor: root, replyCek } = makeRumor(alice.pk, 'root');
    const [parent] = wrapPrivateNote(alice.sk, [bob.pk], root);
    const opened = tryOpenNote(bob.sk, parent)!;

    const reactionOf = (content: string, at: number): Rumor =>
      ({ ...{ pubkey: bob.pk, created_at: at, kind: 7, tags: [['e', root.id]], content }, id: getEventHash({ pubkey: bob.pk, created_at: at, kind: 7, tags: [['e', root.id]], content }) });
    // the older one lands later — order on the wire must not matter
    const conversation = conversationOn(opened, [
      wrapPrivateReply(bob.sk, replyCek, reactionOf('❤', root.created_at + 20)),
      wrapPrivateReply(bob.sk, replyCek, reactionOf('+', root.created_at + 10)),
    ]);

    const toRoot = reactionsTo(conversation, root.id);
    expect(toRoot).toHaveLength(1);
    expect(toRoot[0].content).toBe('❤');
    expect(toRoot[0].pubkey).toBe(bob.pk);
  });
});
