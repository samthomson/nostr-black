import { Loader2 } from 'lucide-react';
import { LightboxTrigger } from '@/components/Lightbox';
import { useAsset } from '@/hooks/useAsset';

/**
 * A profile's banner image through the same media path as avatars.
 * Skeleton / spinner / named failure — never a silent hole. `onOpen`
 * wires it into a lightbox where the caller has one.
 */
export const ProfileBanner = ({ url, onOpen }: { url: string | undefined; onOpen?: () => void }) => {
  const { url: src, error, ref } = useAsset(url, 'media');
  if (!url) {
    return <div className="bg-muted h-32 w-full sm:h-40" />;
  }
  if (error) {
    return (
      <div className="bg-muted text-muted-foreground flex h-32 w-full items-center justify-center text-xs sm:h-40">
        banner failed
      </div>
    );
  }
  if (!src) {
    return (
      <div className="bg-muted flex h-32 w-full items-center justify-center sm:h-40">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  const img = <img src={src} alt="" className="size-full object-cover" />;
  return (
    <div ref={ref} className="bg-muted h-32 w-full overflow-hidden sm:h-40">
      {onOpen ? (
        <LightboxTrigger label="open banner image" onOpen={onOpen} className="size-full">
          {img}
        </LightboxTrigger>
      ) : (
        img
      )}
    </div>
  );
};
