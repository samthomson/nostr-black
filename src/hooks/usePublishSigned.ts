import { useCallback } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { store } from '@/data/store';
import { useRouting } from '@/data/hooks/useRouting';
import { toast } from '@/hooks/useToast';
import { eventTooLarge } from '@/lib/eventSize';

/**
 * Publish an already-signed event. Goes to the user's write relays plus
 * any extra relays the caller names (NIP-09 deletions also go where the
 * deleted event was found). Ingested locally on success.
 */
export const usePublishSigned = (): ((event: NostrEvent, extraRelays?: readonly string[]) => Promise<void>) => {
  const { myWrite } = useRouting();

  return useCallback(async (event, extraRelays = []) => {
    const relays = [...new Set([...myWrite, ...extraRelays])];
    if (relays.length === 0) throw new Error('no write relays');
    if (eventTooLarge(event)) {
      toast({
        title: 'large event',
        description: 'over the usual 64 KB relay limit — some relays may reject it',
      });
    }
    await publish(event, relays);
    store.ingest([event], relays[0]);
  }, [myWrite]);
};
