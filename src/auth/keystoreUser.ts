import { NUser } from '@nostrify/react/login';
import type { NostrSigner } from '@nostrify/types';

/**
 * A user whose signer is the memory-only keystore. Wraps the in-memory
 * NSecSigner in the NUser interface the app consumes — nothing persisted.
 */
export const keystoreUser = (pubkey: string, signer: NostrSigner): NUser =>
  new NUser('x-keystore', pubkey, signer);
