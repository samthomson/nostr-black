import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useProfiles } from '@/data/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';

const followPubkeys = (event: NostrEvent | undefined): string[] =>
  event ? [...new Set(event.tags.filter(([name, value]) => name === 'p' && value).map(([, value]) => value))] : [];

/** Scrollable list of a profile's follows: avatar, name, npub, linked. */
export const FollowsDialog = ({
  followList,
  open,
  onOpenChange,
}: {
  followList: NostrEvent | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const pubkeys = followPubkeys(followList);
  const profiles = useProfiles(open ? pubkeys : [], 'interactive');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[95vw] gap-0 overflow-hidden rounded-sm p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 pt-4 pb-3">
          <DialogTitle className="text-sm font-semibold">
            following {pubkeys.length || '…'}
          </DialogTitle>
        </DialogHeader>
        <ul className="max-h-[70dvh] divide-y overflow-y-auto">
          {pubkeys.map((pubkey) => {
            const metadata = profiles.get(pubkey)?.metadata;
            const name = metadata?.display_name || metadata?.name;
            return (
              <li key={pubkey}>
                <Link
                  to={`/${npubOf(pubkey)}`}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent"
                >
                  <ProfileAvatar
                    pubkey={pubkey}
                    metadata={metadata}
                    waitingMetadata={!metadata}
                    className="size-9 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{name ?? '…'}</span>
                    <span className="text-muted-foreground block truncate font-mono text-xs">{npubOf(pubkey)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
};
