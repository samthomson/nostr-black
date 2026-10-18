import { useEffect } from 'react';
import { nowSec } from '@/lib/timestamp';
import { setAuthSigner } from '@/net/net';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUserState } from '@/hooks/useUserState';
import { parseFollows, parsePrivateFollows } from '@/lib/outbox';
import type { NostrEvent } from '@nostrify/nostrify';
import { useEntity } from './useEntity';
import { useSessionKey } from './useSessionKey';

/**
 * The logged-in user's own kind 3 and 10002, plus NIP-42 AUTH.
 *
 * Replaces `useNostrSync`: the fetch is a scheduler want like any other,
 * so it shares the store and does not open its own sockets. UserState is
 * written only when a newer event actually arrives.
 */
export const useBootstrap = (): void => {
  const { user } = useCurrentUser();
  const { state, updateUser, markRelaySynced } = useUserState();
  const pubkey = user?.pubkey;
  const relays = useEntity(pubkey ? { type: 'relayList', pubkey } : undefined);
  const follows = useEntity(pubkey ? { type: 'followList', pubkey } : undefined);
  const mutes = useEntity(pubkey ? { type: 'muteList', pubkey } : undefined);
  const sk = useSessionKey();

  useEffect(() => {
    setAuthSigner(
      user?.signer
        ? (challenge, relay) =>
            user.signer!.signEvent({
              kind: 22242,
              content: '',
              tags: [
                ['relay', relay],
                ['challenge', challenge],
              ],
              created_at: nowSec(),
            })
        : undefined,
    );
  }, [user]);

  useEffect(() => {
    if (!pubkey) return;
    if (relays.settledAt === undefined && follows.settledAt === undefined && mutes.settledAt === undefined) return;
    markRelaySynced();
  }, [pubkey, relays.settledAt, follows.settledAt, mutes.settledAt, markRelaySynced]);

  // TODO (ui nudge): once `relays` settles without an event, the user
  // publishes no NIP-65 list — surface that here so settings can suggest
  // setting relays. Not built yet; this is the seam.

  useEffect(() => {
    const event = relays.event;
    if (!event || event.created_at <= state.relayMetadata.updatedAt) return;
    const next = event.tags
      .filter(([name, url]) => name === 'r' && !!url)
      .map(([, url, marker]) => ({
        url,
        read: !marker || marker === 'read',
        write: !marker || marker === 'write',
      }));
    if (next.length === 0) return;
    updateUser((current) => ({
      ...current,
      relayMetadata: { relays: next, updatedAt: event.created_at },
    }));
  }, [relays.event, state.relayMetadata.updatedAt, updateUser]);

  useEffect(() => {
    const event: NostrEvent | undefined = follows.event;
    if (!event || event.created_at <= state.follows.updatedAt) return;
    // Public follows from tags; NIP-51 private follows from the sealed
    // content. They merge into one list — the feed and the outbox model
    // treat a private follow identically to a public one, and nobody
    // watching the kind 3 learns who the private half names.
    let privateFollows: string[] = [];
    if (sk) {
      try {
        privateFollows = parsePrivateFollows(sk, event);
      } catch {
        // Undecryptable content is a verdict about the ciphertext, not
        // an excuse to drop the person from the follow list entirely —
        // but we surface it in dev rather than eating it.
        console.warn('[follows] private list content undecryptable');
      }
    }
    updateUser((current) => ({
      ...current,
      follows: {
        pubkeys: [...new Set([...parseFollows(event), ...privateFollows])],
        updatedAt: event.created_at,
      },
    }));
  }, [follows.event, state.follows.updatedAt, updateUser, sk]);
};
