import { describe, expect, it } from 'vitest';
import { generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools';
import {
  KIND_CONNECTION,
  KIND_PRIVATE_NOTE,
  KIND_PRIVATE_REPLY,
  acceptConnection,
  burnerKeyOf,
  closeConnection,
  deletePrivateEvent,
  makeRevision,
  makeRumor,
  noteIdOf,
  openConnection,
  openPrivateNote,
  openPrivateReply,
  replyCekOf,
  requestConnection,
  wrapPrivateNote,
  wrapPrivateReply,
  type Rumor,
} from './feedEncryption';
import { collapseNotes } from './feedEncryptionRead';

const rumorOf = (pubkey: string, content: string, tags: string[][], kind: number): Rumor => {
  const template = { pubkey, created_at: 1790000000, kind, tags, content };
  return { ...template, id: getEventHash(template) };
};

const pair = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

describe('NIP-FE private notes', () => {
  it('author and audience can open; an outsider cannot', () => {
    const alice = pair();
    const bob = pair();
    const eve = pair();
    const { rumor } = makeRumor(alice.pk, 'hello privately');
    const [event] = wrapPrivateNote(alice.sk, [bob.pk], rumor);

    expect(event.kind).toBe(KIND_PRIVATE_NOTE);
    expect(event.pubkey).not.toBe(alice.pk);

    expect(openPrivateNote(alice.sk, event).rumor.content).toBe('hello privately');
    expect(openPrivateNote(bob.sk, event).rumor.content).toBe('hello privately');
    expect(() => openPrivateNote(eve.sk, event)).toThrow('not a recipient');
  });

  it('chunks large audiences and every slice still opens', () => {
    const alice = pair();
    const recipients = Array.from({ length: 3 }, () => pair());
    const { rumor } = makeRumor(alice.pk, 'to many');
    const events = wrapPrivateNote(alice.sk, recipients.map((r) => r.pk), rumor);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const r of recipients) {
      const opened = events.map((e) => {
        try {
          return openPrivateNote(r.sk, e);
        } catch {
          return undefined;
        }
      }).find(Boolean);
      expect(opened?.rumor.content).toBe('to many');
    }
  });

  it('opens an all-viewers reply with the parent reply_cek', () => {
    const alice = pair();
    const bob = pair();
    const { rumor, replyCek } = makeRumor(alice.pk, 'root');
    const [note] = wrapPrivateNote(alice.sk, [bob.pk], rumor);
    const opened = openPrivateNote(bob.sk, note);
    const { rumor: replyRumor } = makeRumor(bob.pk, 'a reply', [['e', opened.rumor.id]]);
    const reply = wrapPrivateReply(bob.sk, opened.replyCek, replyRumor);
    expect(reply.kind).toBe(KIND_PRIVATE_REPLY);
    expect(reply.tags.some(([n, v]) => n === 'n' && v === noteIdOf(replyCek))).toBe(true);
    expect(openPrivateReply(opened.replyCek, reply).content).toBe('a reply');
  });

  it('revisions keep the conversation key, kind, and content tags', () => {
    const alice = pair();
    const picture = rumorOf(alice.pk, 'sunset', [['url', 'https://pics.example/s.jpg'], ['m', 'image/jpeg'], ['reply_cek', 'ab'.repeat(32)]], 20);
    const revision = makeRevision(alice.pk, picture, 'sunset, edited');

    expect(revision.kind).toBe(20);
    expect(revision.tags).toContainEqual(['url', 'https://pics.example/s.jpg']);
    expect(revision.tags).toContainEqual(['m', 'image/jpeg']);
    expect(revision.tags).toContainEqual(['revision_of', picture.id]);
  });

  it('revisions keep the conversation key and supersede the original', () => {
    const alice = pair();
    const { rumor, replyCek } = makeRumor(alice.pk, 'first version');
    const revision = makeRevision(alice.pk, rumor, 'second version');

    expect(replyCekOf(revision)).toEqual(replyCek);
    expect(revision.tags).toContainEqual(['revision_of', rumor.id]);

    const opened = [
      ...wrapPrivateNote(alice.sk, [], rumor),
      ...wrapPrivateNote(alice.sk, [], revision),
    ].map((event) => openPrivateNote(alice.sk, event));
    expect(collapseNotes(opened).map((n) => n.rumor.content)).toEqual(['second version']);
  });

  it('originals carry no n tag; a revision is one conversation event for the whole audience', () => {
    const alice = pair();
    const bob = pair();
    const carol = pair();
    const { rumor, replyCek } = makeRumor(alice.pk, 'v1');
    const [chunk] = wrapPrivateNote(alice.sk, [bob.pk, carol.pk], rumor);
    // Chunk carries aliases only — the publication is not linkable.
    expect(chunk.tags.some(([name]) => name === 'n')).toBe(false);

    const revision = makeRevision(alice.pk, rumor, 'v2');
    const event = wrapPrivateReply(alice.sk, replyCek, revision);
    expect(event.kind).toBe(KIND_PRIVATE_REPLY);
    expect(event.tags).toContainEqual(['n', noteIdOf(replyCek)]);
    // Every holder opens the revision with the reply CEK — both chunks'
    // recipients, from either chunk.
    expect(openPrivateReply(replyCek, event).content).toBe('v2');
    expect(openPrivateReply(replyCek, event).tags).toContainEqual(['revision_of', rumor.id]);
  });

});

describe('NIP-FE connections', () => {
  it('request → accept becomes connected for both parties', () => {
    const alice = pair();
    const bob = pair();
    const offer = requestConnection(alice.sk, bob.pk);
    expect(offer.kind).toBe(KIND_CONNECTION);
    expect(offer.tags.filter(([n]) => n === 'c')).toHaveLength(1);

    const asBob = openConnection(bob.sk, offer);
    expect(asBob.state).toBe('request');
    expect(asBob.peer).toBe(alice.pk);

    const accepted = acceptConnection(bob.sk, asBob);


    expect(openConnection(alice.sk, accepted).state).toBe('connected');
    expect(openConnection(bob.sk, accepted).state).toBe('connected');
  });

  it('close severs the record', () => {
    const alice = pair();
    const bob = pair();
    const offer = requestConnection(alice.sk, bob.pk);
    const accepted = acceptConnection(bob.sk, openConnection(bob.sk, offer));
    const closed = closeConnection(alice.sk, openConnection(alice.sk, accepted));
    expect(openConnection(bob.sk, closed).state).toBe('closed');
  });

  it('cannot be opened by a stranger', () => {
    const alice = pair();
    const bob = pair();
    const eve = pair();
    const offer = requestConnection(alice.sk, bob.pk);
    expect(() => openConnection(eve.sk, offer)).toThrow();
  });
});

describe('private event deletion', () => {
  it('notes carry one b tag, usable only by their author', () => {
    const alice = pair();
    const bob = pair();
    const { rumor } = makeRumor(alice.pk, 'to bob');
    const [note] = wrapPrivateNote(alice.sk, [bob.pk], rumor);

    expect(note.tags.filter(([name]) => name === 'b')).toHaveLength(1);
    expect(getPublicKey(burnerKeyOf(alice.sk, note))).toBe(note.pubkey);
    expect(() => burnerKeyOf(bob.sk, note)).toThrow();
  });

  it('deletes with a burner-signed kind 5', () => {
    const alice = pair();
    const bob = pair();
    const { rumor } = makeRumor(alice.pk, 'delete me');
    const [note] = wrapPrivateNote(alice.sk, [bob.pk], rumor);

    const deletion = deletePrivateEvent(alice.sk, note);
    expect(deletion.kind).toBe(5);
    expect(deletion.pubkey).toBe(note.pubkey);
    expect(deletion.tags).toContainEqual(['e', note.id]);
    expect(verifyEvent(deletion)).toBe(true);
    expect(() => deletePrivateEvent(bob.sk, note)).toThrow();
  });

  it('replies carry the b tag too', () => {
    const bob = pair();
    const { rumor, replyCek } = makeRumor(bob.pk, 'root');
    const replyRumor = makeRumor(bob.pk, 'a reply', [['e', rumor.id]]).rumor;
    const reply = wrapPrivateReply(bob.sk, replyCek, replyRumor);

    expect(getPublicKey(burnerKeyOf(bob.sk, reply))).toBe(reply.pubkey);
  });
});
