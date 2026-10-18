import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/data/hooks/useProfile';
import { parsePrivateFollows } from '@/lib/outbox';
import { useSessionKey } from '@/data/hooks/useSessionKey';

export type FollowVisibility = 'public' | 'private';

/**
 * Which list holds this person in MY follow lists — public tags, sealed
 * content, or neither. Follow rows use it for the move/unfollow action;
 * undefined when the kind 3 has not landed or the session is locked.
 */
export const useFollowVisibility = (pubkey: string): FollowVisibility | undefined => {
  const sk = useSessionKey();
  const { user } = useCurrentUser();
  const { event } = useFollowList(user?.pubkey);
  if (!sk || !event) return undefined;
  if (event.tags.some(([n, v]) => n === 'p' && v === pubkey)) return 'public';
  if (parsePrivateFollows(sk, event).includes(pubkey)) return 'private';
  return undefined;
};
