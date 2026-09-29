import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { queryRelays, type RelayQueryOpts } from '@/net/net';
import { tierRelays, type RelayPlan } from '@/data/routing';

/**
 * Run a plan tier by tier, stopping at the first tier that returns
 * anything. Tiers exist precisely because later ones are more expensive or
 * less likely — querying them after a hit would be waste.
 */
export const queryTiers = async (
  plan: RelayPlan,
  filters: NostrFilter[],
  opts: RelayQueryOpts = {},
): Promise<NostrEvent[]> => {
  for (const tier of plan.tiers) {
    const events = await queryRelays(tierRelays(tier), filters, opts);
    if (events.length > 0) return events;
  }
  return [];
};
