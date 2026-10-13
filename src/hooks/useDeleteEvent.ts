import { useCallback } from 'react';
import { clientTag } from '@/lib/clientTag';
import type { NostrEvent } from '@nostrify/nostrify';
import { publish } from '@/net/net';
import { store } from '@/data/store';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouting } from '@/data/hooks/useRouting';
import { usePublishSigned } from '@/hooks/usePublishSigned';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { KIND_PRIVATE_NOTE, KIND_PRIVATE_REPLY, deletePrivateEvent } from '@/lib/fe';

/**
 * NIP-09 deletion of an event you authored. A public event is deleted by
 * your signer; a private wrapper by the burner key recovered from its `b`
 * tag. The deletion is ingested so the event disappears locally at once.
 */
export const useDeleteEvent = (): ((target: NostrEvent) => Promise<void>) => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { myWrite, relays } = useRouting();
  const publishSigned = usePublishSigned();

  return useCallback(async (target: NostrEvent) => {
    if (target.kind === KIND_PRIVATE_NOTE || target.kind === KIND_PRIVATE_REPLY) {
      if (!sk) throw new Error('session key required to delete a private event');
      await publishSigned(deletePrivateEvent(sk, target));
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
    await publish(deletion, relays({ kind: 'publish', event: deletion }));
    store.ingest([deletion], myWrite[0] ?? '');
  }, [user, sk, myWrite, relays, publishSigned]);
};
