import { useCallback } from 'react';
import { clientTag } from '@/lib/clientTag';
import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { eventKey, store } from '@/data/store';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouting } from '@/data/hooks/useRouting';
import { usePublishSigned } from '@/hooks/usePublishSigned';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { deletePrivateEvent, isPrivateKind } from '@/lib/feedEncryption';

/**
 * NIP-09 deletion of an event you authored. A public event is deleted by
 * your signer; a private wrapper by the burner key recovered from its `b`
 * tag. Both go to your write relays and to the relays the event was found
 * on, and are ingested so the event disappears locally at once.
 */
export const useDeleteEvent = (): ((target: NostrEvent) => Promise<void>) => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { relays } = useRouting();
  const publishSigned = usePublishSigned();

  return useCallback(async (target: NostrEvent) => {
    const foundOn = store.get(eventKey(target.id)).foundOn ?? [];
    if (isPrivateKind(target.kind)) {
      if (!sk) throw new Error('session key required to delete a private event');
      await publishSigned(deletePrivateEvent(sk, target), foundOn);
      return;
    }
    if (!user) throw new Error('not logged in');
    const tags: string[][] = [['e', target.id]];
    const tag = clientTag();
    if (tag) tags.push(['client', tag]);
    const deletion = await user.signer.signEvent({
      kind: 5,
      content: '',
      tags,
      created_at: Math.floor(Date.now() / 1000),
    });
    const targets = [...new Set([...foundOn, ...relays({ kind: 'publish', event: deletion })])];
    await publish(deletion, targets);
    store.ingest([deletion], targets[0] ?? '');
  }, [user, sk, relays, publishSigned]);
};
