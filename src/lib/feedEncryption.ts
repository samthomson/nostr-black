/**
 * NIP-FE private generics on the NIP-FB envelope: wrap any nostr event
 * as a private note (1370, establishes security) or a related private
 * event (1470, inherits it), plus pairwise connections (30378).
 * https://github.com/nostr-protocol/nips/pull/2488
 */
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools';
import { nowSec } from './timestamp';
import type { UnsignedEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  aliasOf,
  connAddrOf,
  connKeyOf,
  derivedIdentityIdOf,
  encodeEnvelope,
  noteIdOf,
  openAuthorKey,
  openEnvelopeWithCek,
  openSlotless,
  parseEnvelope,
  sealAuthorKey,
  sealEnvelope,
  sealSlotless,
  type FbEnvelope,
} from './falseBottom';

export const KIND_SEAL = 124;
export const KIND_PRIVATE_NOTE = 1370;
export const KIND_PRIVATE_REPLY = 1470;
export const KIND_CONNECTION = 30378;

/** The burner-signed private wrapper kinds — notes and replies. */
export const isPrivateKind = (kind: number): boolean =>
  kind === KIND_PRIVATE_NOTE || kind === KIND_PRIVATE_REPLY;

const CHUNK = 480;
const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

const jittered = (): number => nowSec() - Math.floor(Math.random() * 2 * 24 * 3600);

export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export type ConnectionStatus = 'open' | 'closed';

export interface ConnectionPayload {
  parties: [string, string];
  created_at: number;
  status: ConnectionStatus;
  sigs: { pk: string; sig: string }[];
}

export interface ConnectionRecord {
  event: NostrEvent;
  payload: ConnectionPayload;
  peer: string;
  /** request = one sig; connected = two; closed = status */
  state: 'request' | 'connected' | 'closed';
}

export interface OpenedNote {
  wrapper: NostrEvent;
  rumor: Rumor;
  replyCek: Uint8Array;
}

const rumorHash = (template: UnsignedEvent): string => getEventHash(template);

export const replyCekOf = (rumor: Rumor): Uint8Array | undefined => {
  const hex = rumor.tags.find(([n]) => n === 'reply_cek')?.[1];
  return hex ? hexToBytes(hex) : undefined;
};

export const makeRumor = (
  authorPk: string,
  content: string,
  extraTags: string[][] = [],
  kind: number = 1,
): { rumor: Rumor; replyCek: Uint8Array } => {
  const replyCek = randomBytes(32);
  const template: UnsignedEvent = {
    pubkey: authorPk,
    created_at: nowSec(),
    kind,
    tags: [['reply_cek', bytesToHex(replyCek)], ...extraTags],
    content,
  };
  return { replyCek, rumor: { ...template, id: rumorHash(template) } };
};

/**
 * A revision: same conversation key and kind, new content. Authorization
 * is seal-matches-root — only the same author's revision renders as an
 * edit; anyone else's revision_of is just their own reply.
 */
export const makeRevision = (authorPk: string, parent: Rumor, content: string): Rumor => {
  const parentCek = replyCekOf(parent);
  if (!parentCek) throw new Error('parent rumor missing reply_cek');
  // The revision keeps the parent's kind and tags — a picture stays a
  // picture (url/m tags), a reply keeps the e tag it responded to.
  const kept = parent.tags.filter(([name]) => name !== 'reply_cek' && name !== 'revision_of');
  const template: UnsignedEvent = {
    pubkey: authorPk,
    created_at: nowSec(),
    kind: parent.kind,
    tags: [...kept, ['reply_cek', bytesToHex(parentCek)], ['revision_of', parent.id]],
    content,
  };
  return { ...template, id: rumorHash(template) };
};

const wrapSeal = (authorSk: Uint8Array, cek: Uint8Array, rumor: Rumor): NostrEvent =>
  finalizeEvent({
    kind: KIND_SEAL,
    created_at: jittered(),
    tags: [],
    content: encodeEnvelope(sealSlotless(cek, utf8.encode(JSON.stringify(rumor)))),
  }, authorSk) as NostrEvent;

const unwrapRumor = (cek: Uint8Array, seal: NostrEvent): Rumor => {
  if (seal.kind !== KIND_SEAL) throw new Error('expected kind 124 seal');
  if (!verifyEvent(seal)) throw new Error('invalid seal signature');
  const rumor = JSON.parse(utf8d.decode(openSlotless(cek, parseEnvelope(seal.content)))) as Rumor;
  if (rumor.pubkey !== seal.pubkey) throw new Error('seal/rumor pubkey mismatch');
  const id = rumorHash({
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    content: rumor.content,
  });
  if (id !== rumor.id) throw new Error('invalid rumor id');
  return rumor;
};

const slice = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)]);
  return out;
};

const junkF = (): string[][] =>
  Array.from({ length: 1 + Math.floor(Math.random() * 20) }, () => ['f', bytesToHex(randomBytes(32))]);

/**
 * Burner-signed kind 1370 chunk(s). Author is always a recipient so they
 * can re-read. Each chunk independently encrypts the same rumor; chunks
 * share no public tag, so the publication size is not observable.
 */
export const wrapPrivateNote = (
  authorSk: Uint8Array,
  recipientPks: readonly string[],
  rumor: Rumor,
): NostrEvent[] => {
  const authorPk = getPublicKey(authorSk);
  const audience = [...new Set([authorPk, ...recipientPks])];
  return slice(audience, CHUNK).map((group) => {
    const burner = generateSecretKey();
    const noteCek = randomBytes(32);
    const seal = wrapSeal(authorSk, noteCek, rumor);
    const { envelope } = sealEnvelope(
      burner,
      group,
      utf8.encode(JSON.stringify(seal)),
      { pad: true, cek: noteCek },
    );
    // f tags address the recipients plus the author's self-alias — the
    // me-me relationship, so one #f query returns the author's whole
    // archive (spec: Author archive; everything identity-derived).
    const aliases = group.map((pk) => ['f', aliasOf(authorSk, pk)]);
    const tags: string[][] = [['b', sealAuthorKey(burner, authorPk)], ...aliases, ...junkF()];
    return finalizeEvent({
      kind: KIND_PRIVATE_NOTE,
      created_at: jittered(),
      tags,
      content: encodeEnvelope(envelope),
    }, burner) as NostrEvent;
  });
};

export const openPrivateNote = (sk: Uint8Array, event: NostrEvent): OpenedNote => {
  if (event.kind !== KIND_PRIVATE_NOTE) throw new Error('expected kind 1370');
  const envelope = parseEnvelope(event.content);
  const { cek, payload } = openEnvelopeWithCek(sk, event.pubkey, envelope);
  const seal = JSON.parse(utf8d.decode(payload)) as NostrEvent;
  const rumor = unwrapRumor(cek, seal);
  const replyCek = replyCekOf(rumor);
  if (!replyCek) throw new Error('rumor missing reply_cek');
  return { wrapper: event, rumor, replyCek };
};

export const wrapPrivateReply = (
  authorSk: Uint8Array,
  replyCek: Uint8Array,
  rumor: Rumor,
): NostrEvent => {
  const burner = generateSecretKey();
  const seal = wrapSeal(authorSk, replyCek, rumor);
  const envelope = sealSlotless(replyCek, utf8.encode(JSON.stringify(seal)));
  return finalizeEvent({
    kind: KIND_PRIVATE_REPLY,
    created_at: jittered(),
    tags: [['b', sealAuthorKey(burner, getPublicKey(authorSk))], ['n', noteIdOf(replyCek)]],
    content: encodeEnvelope(envelope),
  }, burner) as NostrEvent;
};

export const openPrivateReply = (replyCek: Uint8Array, event: NostrEvent): Rumor => {
  if (event.kind !== KIND_PRIVATE_REPLY) throw new Error('expected kind 1470');
  const envelope = parseEnvelope(event.content);
  const seal = JSON.parse(utf8d.decode(openSlotless(replyCek, envelope))) as NostrEvent;
  return unwrapRumor(replyCek, seal);
};

/** One decode level of a private event, for display in the broadcast
 * modal's event tab. */
export interface EventLayer {
  /** Level name: wrapper / seal / rumour. */
  name: string;
  /** The decoded event at this level — parsed objects, not b64 blobs. */
  decoded: unknown;
}

/**
 * The decode levels of a private wrapper, for display: the outer event
 * (envelope elided), the seal, the rumour. Both shapes — a 1370 note
 * opens its author slot for the CEK; a 1470 reply is slotless under the
 * conversation's reply CEK. Each level that fails to open says so;
 * earlier levels still show.
 */
export const privateNoteLayers = (
  sk: Uint8Array,
  wrapper: NostrEvent,
  replyCek?: Uint8Array,
): readonly EventLayer[] => {
  const layers: EventLayer[] = [
    { name: 'wrapper', decoded: { ...wrapper, content: '‹envelope›' } },
  ];
  try {
    const envelope = parseEnvelope(wrapper.content);
    const { cek, payload } = wrapper.kind === KIND_PRIVATE_NOTE
      ? openEnvelopeWithCek(sk, wrapper.pubkey, envelope)
      : slotlessReply(replyCek, envelope);
    const seal = JSON.parse(utf8d.decode(payload)) as NostrEvent;
    layers.push({ name: 'seal', decoded: seal });
    layers.push({ name: 'rumour', decoded: unwrapRumor(cek, seal) });
  } catch {
    layers.push({ name: 'seal', decoded: '‹undecodable›' });
    layers.push({ name: 'rumour', decoded: '‹undecodable›' });
  }
  return layers;
};

/** A 1470 has no slots — its CEK is the conversation's reply key. */
const slotlessReply = (replyCek: Uint8Array | undefined, envelope: FbEnvelope): { cek: Uint8Array; payload: Uint8Array } => {
  if (!replyCek) throw new Error('reply CEK required for a 1470');
  return { cek: replyCek, payload: openSlotless(replyCek, envelope) };
};


const partiesOf = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

/** Bytes both parties sign — no sigs field, parties sorted. */
export const connectionSignedBytes = (
  parties: [string, string],
  created_at: number,
  status: ConnectionStatus,
): Uint8Array =>
  sha256(utf8ToBytes(JSON.stringify({ created_at, parties, status })));

export const signConnection = (
  sk: Uint8Array,
  parties: [string, string],
  created_at: number,
  status: ConnectionStatus,
): { pk: string; sig: string } => ({
  pk: getPublicKey(sk),
  sig: bytesToHex(schnorr.sign(connectionSignedBytes(parties, created_at, status), sk)),
});

const verifyConnSig = (
  payload: ConnectionPayload,
  entry: { pk: string; sig: string },
): boolean => {
  if (!payload.parties.includes(entry.pk)) return false;
  return schnorr.verify(
    hexToBytes(entry.sig),
    connectionSignedBytes(payload.parties, payload.created_at, payload.status),
    hexToBytes(entry.pk),
  );
};

const stateOf = (payload: ConnectionPayload): ConnectionRecord['state'] => {
  if (payload.status === 'closed') return 'closed';
  const valid = payload.sigs.filter((s) => verifyConnSig(payload, s));
  if (valid.length >= 2) return 'connected';
  return 'request';
};
const peerIdentityIdOf = (sk: Uint8Array, event: NostrEvent): string | undefined =>
  event.tags.find(([name, value]) => name === 'c' && value !== derivedIdentityIdOf(sk))?.[1];

export const wrapConnectionRecord = (
  sk: Uint8Array,
  peerPk: string,
  payload: ConnectionPayload,
  peerIdentityId?: string,
): NostrEvent => {
  const me = getPublicKey(sk);
  const envelopeSk = connKeyOf(sk, peerPk);
  const { envelope } = sealEnvelope(
    envelopeSk,
    [me, peerPk],
    utf8.encode(JSON.stringify(payload)),
    { pad: false },
  );
  const tags: string[][] = [
    ['d', connAddrOf(sk, peerPk)],
    ['c', derivedIdentityIdOf(sk)],
  ];
  if (peerIdentityId) tags.push(['c', peerIdentityId]);
  return finalizeEvent({
    kind: KIND_CONNECTION,
    created_at: nowSec(),
    tags,
    content: encodeEnvelope(envelope),
  }, envelopeSk) as NostrEvent;
};

export const openConnection = (sk: Uint8Array, event: NostrEvent): ConnectionRecord => {
  if (event.kind !== KIND_CONNECTION) throw new Error('expected kind 30378');
  const envelope = parseEnvelope(event.content);
  const payload = JSON.parse(utf8d.decode(openEnvelopeWithCek(sk, event.pubkey, envelope).payload)) as ConnectionPayload;
  const me = getPublicKey(sk);
  const peer = payload.parties.find((p) => p !== me);
  if (!peer) throw new Error('not a party to this connection');
  return { event, payload, peer, state: stateOf(payload) };
};

export const requestConnection = (sk: Uint8Array, peerPk: string): NostrEvent => {
  const me = getPublicKey(sk);
  const parties = partiesOf(me, peerPk);
  const created_at = nowSec();
  return wrapConnectionRecord(sk, peerPk, {
    parties,
    created_at,
    status: 'open',
    sigs: [signConnection(sk, parties, created_at, 'open')],
  });
};

export const acceptConnection = (sk: Uint8Array, record: ConnectionRecord): NostrEvent => {
  const payload: ConnectionPayload = {
    ...record.payload,
    sigs: [
      ...record.payload.sigs,
      signConnection(sk, record.payload.parties, record.payload.created_at, record.payload.status),
    ],
  };
  return wrapConnectionRecord(sk, record.peer, payload, peerIdentityIdOf(sk, record.event));
};

export const closeConnection = (sk: Uint8Array, record: ConnectionRecord): NostrEvent => {
  const created_at = nowSec();
  const payload: ConnectionPayload = {
    parties: record.payload.parties,
    created_at,
    status: 'closed',
    sigs: [signConnection(sk, record.payload.parties, created_at, 'closed')],
  };
  return wrapConnectionRecord(sk, record.peer, payload, peerIdentityIdOf(sk, record.event));
};

/** Recover the burner signing key of one of our private events, from
 * its `b` tag. Throws for anyone but the author. */
export const burnerKeyOf = (sk: Uint8Array, event: NostrEvent): Uint8Array => {
  const packed = event.tags.find(([name]) => name === 'b')?.[1];
  if (!packed) throw new Error('no b tag on event');
  return openAuthorKey(sk, event.pubkey, packed);
};

/** NIP-09 deletion of a private event, signed by its recovered burner. */
export const deletePrivateEvent = (sk: Uint8Array, event: NostrEvent): NostrEvent =>
  finalizeEvent({
    kind: 5,
    created_at: nowSec(),
    tags: [['e', event.id]],
    content: '',
  }, burnerKeyOf(sk, event)) as NostrEvent;

export { aliasOf, connAddrOf, derivedIdentityIdOf, noteIdOf };
