import { useState } from 'react';
import { VolumeX } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { useEntity } from '@/data/hooks/useEntity';
import { moveMute, parseMutes } from '@/lib/outbox';
import { npubOf } from '@/lib/format';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Visibility = 'public' | 'private';

/**
 * Mute for one pubkey, public or private (NIP-51 sealed content) — the
 * dropdown carries the choice, private is the sane default for a list
 * whose names can expose you. Unmute removes from whichever list holds
 * the person.
 */
export const MuteButton = ({ pubkey, compact = false }: {
  pubkey: string;
  compact?: boolean;
}) => {
  const { user } = useCurrentUser();
  const { request, dialog } = useBroadcastFlow();
  const { relays } = useRouting();
  const sk = useSessionKey();
  const pubkeySelf = user?.pubkey;
  const muteList = useEntity(pubkeySelf ? { type: 'muteList', pubkey: pubkeySelf } : undefined);
  const mutes = sk ? parseMutes(sk, muteList.event) : { public: [], private: [] };
  const muted = mutes.public.includes(pubkey) || mutes.private.includes(pubkey);
  const [busy, setBusy] = useState(false);

  const move = async (to: Visibility | false): Promise<void> => {
    if (!user?.signer || !sk) return;
    setBusy(true);
    try {
      const parts = moveMute(sk, muteList.event, pubkey, to);
      const updated = await user.signer.signEvent({
        kind: 10000,
        content: parts.content,
        tags: parts.tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      const verb = to === false ? 'unmute' : to === 'private' ? 'privately mute' : 'mute';
      request({
        grade: 'public',
        label: muted ? 'unmute' : 'mute',
        content: `${verb} ${npubOf(pubkey).slice(0, 16)}…`,
        identityPubkey: user.pubkey,
        relays: relays({ kind: 'publish', eventKind: updated.kind }),
        events: [updated],
      });
    } finally {
      setBusy(false);
    }
  };

  if (pubkey === pubkeySelf) return null;

  return (
    <>
      {muted ? (
        <Button
          variant="outline"
          size={compact ? 'xs' : 'sm'}
          disabled={busy}
          onClick={() => void move(false)}
        >
          <VolumeX className="size-3.5" />
          unmute
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size={compact ? 'xs' : 'sm'}
              disabled={busy}
              aria-label="mute"
            >
              <VolumeX className="size-3.5" />
              {compact ? '' : 'mute'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => void move('private')}>
              mute privately
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void move('public')}>
              mute publicly
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialog}
    </>
  );
};
