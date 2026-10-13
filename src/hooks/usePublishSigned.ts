import { useCallback } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { store } from '@/data/store';
import { useRouting } from '@/data/hooks/useRouting';

/**
 * Publish an already-signed event to our write relays. Does not add a
 * client tag — the caller owns the envelope.
 */
export const usePublishSigned = (): ((event: NostrEvent) => Promise<void>) => {
  const { myWrite } = useRouting();

  return useCallback(async (event: NostrEvent) => {
    if (myWrite.length === 0) throw new Error('no write relays');
    await publish(event, myWrite);
    store.ingest([event], myWrite[0]);
  }, [myWrite]);
};
