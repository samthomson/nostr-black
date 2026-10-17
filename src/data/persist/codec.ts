import type { NostrEvent } from '@nostrify/nostrify';

/**
 * The encryption seam.
 *
 * Everything written to disk passes through a codec. Today both directions
 * are the identity function, but the boundary exists from the first commit
 * because retrofitting it later means touching every store and every read
 * path — and both halves are async now, since real encryption is WebCrypto
 * and turning a sync API async afterwards is the same rewrite again.
 *
 * See `docs/data-layer.md` § Persistence.
 */

/** One entity as it exists on disk, before the codec sees it. */
export interface PersistedRecord {
  event: NostrEvent;
  /** Relays that served it. Routing for engagement depends on this. */
  foundOn: readonly string[];
}

/** Whatever the codec produced. Only the codec may interpret it. */
export type Encoded = unknown;

export interface RecordCodec {
  encode(record: PersistedRecord): Promise<Encoded>;
  decode(encoded: Encoded): Promise<PersistedRecord>;
}

export const identityCodec: RecordCodec = {
  encode: async (record) => record,
  // The only writer of these rows is `encode` above, so the shape is ours.
  decode: async (encoded) => encoded as PersistedRecord,
};

let codec: RecordCodec = identityCodec;

export const getCodec = (): RecordCodec => codec;

/**
 * Swapping the codec invalidates everything already written, so the caller
 * is responsible for clearing the database in the same breath.
 */
export const setCodec = (next: RecordCodec): void => {
  codec = next;
};
