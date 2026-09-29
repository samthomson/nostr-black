import { useCallback, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { publish, setRoutePreference, getMaxConnections } from '@/net/net';
import { isDesktop } from '@/net/runtime';
import { useAppContext } from './useAppContext';
import { useUserState } from './useUserState';
import { useCurrentUser } from './useCurrentUser';
import { relayPlan, flattenPlan } from '@/data/routing';

/** Publish the user's NIP-65 relay list as a fresh kind 10002: signs with
 * the current signer, pushes to the relays the list itself names ∪
 * discovery (outbox-correct), and updates config on success. */
export function usePublishRelayList() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { updateUser } = useUserState();

  return useMutation({
    mutationFn: async (relays: { url: string; read: boolean; write: boolean }[]) => {
      if (!user) throw new Error('not logged in');
      const event: NostrEvent = await user.signer.signEvent({
        kind: 10002,
        content: '',
        tags: relays.map((r) =>
          r.read && r.write ? ['r', r.url] : ['r', r.url, r.read ? 'read' : 'write'],
        ),
        created_at: Math.floor(Date.now() / 1000),
      });

      // Routed against the *draft* list, not the synced one: this event is
      // what changes where we write, so it has to reach the relays it names.
      await publish(event, flattenPlan(relayPlan(
        { kind: 'publish', event },
        { myRelays: relays, discovery: config.discoveryRelays, authorRelays: new Map() },
      )));

      updateUser((current) => ({
        ...current,
        relayMetadata: { relays, updatedAt: event.created_at },
      }));
      return event;
    },
  });
}

/** Tor/direct route preference — desktop only, persisted in app config.
 * Pushes the preference into Rust (and the egress logger) on change. */
export function useRoutePreference() {
  const { config, updateConfig } = useAppContext();

  useEffect(() => {
    if (isDesktop()) void setRoutePreference(config.torEnabled);
  }, [config.torEnabled]);

  const set = useCallback(
    (tor: boolean) => updateConfig((current) => ({ ...current, torEnabled: tor })),
    [updateConfig],
  );
  return { torEnabled: config.torEnabled, set };
}

/** The runtime check as a hook — components never import src/net directly. */
export function useIsDesktop(): boolean {
  return isDesktop();
}

/** The pool's circuit budget. Static per runtime until settings can set it. */
export function useMaxConnections(): number {
  return getMaxConnections();
}
