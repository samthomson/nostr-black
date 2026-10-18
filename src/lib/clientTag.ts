/**
 * The client tag stamped on published events — the one place that decides.
 *
 * A client tag is published metadata: everyone on the relays sees which
 * app (and therefore something about the user) produced an event. So the
 * value is always a deliberate setting, never a default-on:
 *
 * - none  — no tag at all (default)
 * - black — tag "nostr.black", for users who want the attribution
 */
import type { ClientTagConfig } from '@/contexts/AppContext';

export const BLACK_CLIENT_TAG = 'nostr.black';

/** Common clients, preseeded for the spoof pool. */
export const COMMON_CLIENTS = [
  'Damus',
  'Primal',
  'Amethyst',
  'Ditto',
  'Iris',
  'Nostur',
  'Current',
] as const;

/** FNV-1a over a hex/utf string — a stable 32-bit seed. */
const seedOf = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** The `client` tag value for this event, or undefined to send none.
 * Spoof seeds from the event's content (or id, for deletions): the same
 * note always claims the same client — edit-tab re-previews are stable —
 * while different notes rotate the pool. */
export const clientTagOf = (policy: ClientTagConfig, seed?: string): string | undefined => {
  if (policy.mode === 'black') return BLACK_CLIENT_TAG;
  if (policy.mode !== 'spoof' || policy.spoof.length === 0) return undefined;
  if (seed === undefined || seed === '') return policy.spoof[0]!;
  return policy.spoof[seedOf(seed) % policy.spoof.length]!;
};
