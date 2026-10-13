import { describe, expect, it } from 'vitest';
import { generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { makeRumor, wrapPrivateNote, type Rumor } from './fe';
import { collapseNotes, tryOpenNote } from './feRead';

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
