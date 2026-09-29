import { useEffect } from 'react';
import { setAuthSigner } from '@/net/net';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUserState } from '@/hooks/useUserState';
import { parseFollows } from '@/lib/outbox';
import { useEntity } from './useEntity';

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
              created_at: Math.floor(Date.now() / 1000),
            })
        : undefined,
    );
  }, [user]);

  useEffect(() => {
    if (!pubkey) return;
    if (relays.settledAt === undefined && follows.settledAt === undefined) return;
    markRelaySynced();
  }, [pubkey, relays.settledAt, follows.settledAt, markRelaySynced]);

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
    const event = follows.event;
    if (!event || event.created_at <= state.follows.updatedAt) return;
    updateUser((current) => ({
      ...current,
      follows: { pubkeys: parseFollows(event), updatedAt: event.created_at },
    }));
  }, [follows.event, state.follows.updatedAt, updateUser]);
};
