import { useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { queryRelays, setAuthSigner } from '@/net/net';
import { writeRelays } from '@/lib/appRelays';

/**
 * Global sync: the user's NIP-65 relay list (kind 10002), plus wiring the
 * NIP-42 auth signer from the current login.
 */
export function useNostrSync() {
  const { user } = useCurrentUser();
  const { config, updateConfig, markRelaySynced, relaySyncNonce } = useAppContext();

  // NIP-42: relays that challenge us get a signed kind 22242 from the
  // current user's signer. Unset when logged out.
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
    if (!user) return;

    const syncRelaysFromNostr = async () => {
      try {
        // Discovery: the user's own 10002 may not be on the app defaults —
        // ask their write relays ∪ their discovery relays.
        const relays = [
          ...new Set([
            ...writeRelays(config),
            ...config.discoveryRelays,
          ]),
        ];
        const events = await queryRelays(
          relays,
          [{ kinds: [10002], authors: [user.pubkey], limit: 1 }],
        );

        // Latest 10002 wins (replaceable kind).
        const event = events.sort((a, b) => b.created_at - a.created_at)[0];
        if (!event) return;

        // Only update if the event is newer than our stored data
        if (event.created_at > config.relayMetadata.updatedAt) {
          const fetchedRelays = event.tags
            .filter(([name]) => name === 'r')
            .map(([_, url, marker]) => ({
              url,
              read: !marker || marker === 'read',
              write: !marker || marker === 'write',
            }));

          if (fetchedRelays.length > 0) {
            updateConfig((current) => ({
              ...current,
              relayMetadata: {
                relays: fetchedRelays,
                updatedAt: event.created_at,
              },
            }));
          }
        }
      } catch (error) {
        console.error('Failed to sync relays from Nostr:', error);
      } finally {
        // Every completed attempt (found or not) marks discovery settled.
        markRelaySynced();
      }
    };

    void syncRelaysFromNostr();
    // Deps keyed to updatedAt: re-sync when a newer 10002 lands, not on
    // every relay-array identity change (which this sync itself causes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, config.relayMetadata.updatedAt, updateConfig, markRelaySynced, relaySyncNonce]);
}
