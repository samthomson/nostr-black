import { useMemo } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import {
  relayPlan,
  flattenPlan,
  myReadRelays,
  myWriteRelays,
  type AuthorRelays,
  type Intent,
  type RelayPlan,
} from '@/data/routing';
import { authorRelays as storeAuthorRelays } from '@/data/context';

/**
 * The routing policy bound to the current user and app config — how hooks
 * and components get relay URLs. Nothing outside `src/data/routing.ts`
 * decides where a request goes.
 *
 * Where other people publish comes from the event store, so a caller never
 * has to have fetched a kind 10002 itself to route by it. Passing an
 * explicit map is still possible for a list not yet ingested — publishing
 * a relay list routes against the draft, not the synced copy.
 */
export const useRouting = () => {
  const { config } = useAppContext();
  const { state } = useUserState();
  const myRelays = state.relayMetadata.relays;
  const discovery = config.discoveryRelays;

  return useMemo(() => {
    const self = { myRelays, discovery };
    const plan = (intent: Intent, authorRelays: AuthorRelays = storeAuthorRelays):
      RelayPlan => relayPlan(intent, { ...self, authorRelays });

    return {
      myRead: myReadRelays(self),
      myWrite: myWriteRelays(self),
      plan,
      /** Every relay in the plan, for callers that fan out in a single pass. */
      relays: (intent: Intent, authorRelays?: AuthorRelays) =>
        flattenPlan(plan(intent, authorRelays)),
    };
  }, [myRelays, discovery]);
};
