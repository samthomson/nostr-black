import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAsset } from '@/hooks/useAsset';
import { cn } from '@/lib/utils';
import type { NostrMetadata } from '@nostrify/nostrify';

type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Avatar for a pubkey with metadata: the picture is fetched through the
 * transport layer (Tor/direct on desktop, plain https on web) via useAsset.
 * Every avatar in the app renders through this — one media path, no leaks.
 *
 * Never letter/initials placeholders. Spinner while metadata or bytes load;
 * empty muted only when we know there is no picture.
 */
export const ProfileAvatar = ({
  pubkey,
  metadata,
  className,
  waitingMetadata = false,
}: {
  pubkey: string;
  metadata: NostrMetadata | undefined;
  className?: string;
  /** Kind-0 still in flight — spinner, not an empty hole. */
  waitingMetadata?: boolean;
}) => {
  void pubkey;
  const { url: picture, error, ref } = useAsset(metadata?.picture, 'avatar');
  const [imgStatus, setImgStatus] = useState<ImageStatus>('idle');
  const [trackedPicture, setTrackedPicture] = useState(picture);
  if (picture !== trackedPicture) {
    setTrackedPicture(picture);
    setImgStatus('idle');
  }

  const expectingImage = waitingMetadata || !!metadata?.picture;
  const pending =
    expectingImage &&
    !error &&
    (waitingMetadata || !picture || imgStatus === 'idle' || imgStatus === 'loading');

  return (
    <div ref={ref} className="inline-flex leading-none">
      <Avatar className={cn('bg-muted', className)}>
        {picture && (
          <AvatarImage
            src={picture}
            alt={metadata?.name ?? 'avatar'}
            onLoadingStatusChange={setImgStatus}
          />
        )}
        <AvatarFallback className="bg-muted rounded-sm">
          {pending ? (
            <Loader2 className="size-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </AvatarFallback>
      </Avatar>
    </div>
  );
};
