import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUserState } from '@/hooks/useUserState';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { useFollowList } from '@/data/hooks/useProfile';
import { moveFollow } from '@/lib/outbox';
import { npubOf } from '@/lib/format';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSessionKey } from '@/data/hooks/useSessionKey';

type Visibility = 'public' | 'private';

/**
 * Follow / unfollow for one pubkey, public or private (NIP-51 sealed
 * content). The choice is two buttons in the privacy colours — white
 * public, black private — and the modal previews the same rebuild the
 * settings overview uses. Unfollow removes from whichever list holds
 * the person.
 */
export const FollowButton = ({ pubkey, compact = false }: {
  pubkey: string;
  /** Hover-card footer sizing. */
  compact?: boolean;
}) => {
  const { user } = useCurrentUser();
  const { request, dialog } = useBroadcastFlow();
  const { relays } = useRouting();
  const { event: contactList } = useFollowList(user?.pubkey);
  const sk = useSessionKey();
  const { state } = useUserState();
  const follows = state.follows.pubkeys.includes(pubkey);
  const [busy, setBusy] = useState(false);

  const move = async (to: Visibility | false): Promise<void> => {
    if (!user?.signer || !sk) return;
    setBusy(true);
    try {
      const parts = moveFollow(sk, contactList, pubkey, to);
      const updated = await user.signer.signEvent({
        kind: 3,
        content: parts.content,
        tags: parts.tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      const verb = to === false ? 'remove' : to === 'private' ? 'privately follow' : 'follow';
      request({
        grade: 'public',
        label: follows ? 'unfollow' : 'follow',
        content: `${verb} ${npubOf(pubkey).slice(0, 16)}…`,
        identityPubkey: user.pubkey,
        relays: relays({ kind: 'publish', eventKind: updated.kind }),
        events: [updated],
      });
    } finally {
      setBusy(false);
    }
  };

  if (follows) {
    return (
      <>
        <Button
          variant="privacy"
          size={compact ? 'xs' : 'sm'}
          disabled={busy}
          className={cn(!compact && PRIVACY_BUTTON, PRIVACY.public.className)}
          onClick={() => void move(false)}
        >
          unfollow
        </Button>
        {dialog}
      </>
    );
  }

  const btn = (to: Visibility) => (
    <Button
      variant="privacy"
      size={compact ? 'xs' : 'sm'}
      disabled={busy}
      aria-label={`follow ${to === 'private' ? 'privately' : 'publicly'}`}
      className={cn(
        !compact && PRIVACY_BUTTON,
        to === 'private' ? PRIVACY.private.className : PRIVACY.public.className,
      )}
      onClick={() => void move(to)}
    >
      {to === 'private' ? (compact ? 'follow' : 'follow privately') : 'follow'}
    </Button>
  );

  return (
    <>
      <span className="inline-flex gap-2">
        {btn('public')}
        {btn('private')}
      </span>
      {dialog}
    </>
  );
};

