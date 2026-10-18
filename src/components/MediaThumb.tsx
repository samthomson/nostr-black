import { useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { useAsset } from '@/hooks/useAsset';
import { cn } from '@/lib/utils';

/**
 * One remote image thumbnail with the app's media states: spinner
 * while the bytes load (skeletons-for-loading doctrine), a dashed dud
 * naming the failure when they can't — never a broken-image glyph.
 * Transport-correct on desktop (Tor/direct via useAsset) and web
 * (identity url, decode failure caught at render).
 *
 * For chrome thumbnails — diff previews, settings rows. Feed media
 * uses Note's MediaItem; avatars use ProfileAvatar.
 */
export const MediaThumb = ({ url, className }: { url: string; className?: string }) => {
  const { url: src, error, ref } = useAsset(url);
  const [failed, setFailed] = useState(false);

  if (error || failed) {
    return (
      <div
        ref={ref}
        title={error ?? 'image failed to load'}
        className={cn(
          'border-border/60 text-muted-foreground flex items-center justify-center rounded-sm border border-dashed',
          className,
        )}
      >
        <ImageOff className="min-h-3 min-w-3 size-1/2" />
      </div>
    );
  }
  if (!src) {
    return (
      <div ref={ref} className={cn('bg-muted flex items-center justify-center rounded-sm', className)}>
        <Loader2 className="text-muted-foreground min-h-3 min-w-3 size-1/2 animate-spin" />
      </div>
    );
  }
  return (
    <div ref={ref} className="inline-flex leading-none">
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={cn('rounded-sm object-cover', className)}
      />
    </div>
  );
};
