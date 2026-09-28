import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAsset } from '@/hooks/useAsset';
import { npubOf } from '@/lib/format';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Avatar for a pubkey with metadata: the picture is fetched through the
 * transport layer (Tor/direct on desktop, plain https on web) via useAsset.
 * Every avatar in the app renders through this — one media path, no leaks.
 */
export const ProfileAvatar = ({
  pubkey,
  metadata,
  className,
}: {
  pubkey: string;
  metadata: NostrMetadata | undefined;
  className?: string;
}) => {
  const { url: picture, error, ref } = useAsset(metadata?.picture, 'avatar');
  const loading = !!metadata?.picture && !picture && !error;
  return (
    <div ref={ref} className="inline-flex leading-none">
      <Avatar className={className}>
        {picture && <AvatarImage src={picture} alt={metadata?.name ?? 'avatar'} />}
        {loading ? (
          <AvatarFallback>
            <Loader2 className="size-1/2 animate-spin text-muted-foreground" />
          </AvatarFallback>
        ) : (
          <AvatarFallback>{npubOf(pubkey).slice(4, 6).toUpperCase()}</AvatarFallback>
        )}
      </Avatar>
    </div>
  );
};
