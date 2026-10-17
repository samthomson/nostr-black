import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAsset } from '@/hooks/useAsset';
import { VIDEO_URL } from '@/lib/mediaUrls';
import { PRIVACY, type PrivacyGrade } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/**
 * Media viewer for a set of images: the showing item large and centred in a
 * modal, dot jump buttons and ghost prev/next arrows beneath it, and the
 * neighbours preloaded through the same transport path as the feed
 * (useAsset — no direct loads). The modal wears the content's privacy grade
 * (public = white, private = black; controls are the inversion). Escape or
 * the backdrop closes; nothing inside steals focus on open — the modal
 * itself takes it, and the close X sits in its own top band, clear of the
 * image.
 */
export const Lightbox = ({
  urls,
  index,
  onIndex,
  onClose,
  alt,
  grade,
}: {
  urls: readonly string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  alt: string;
  /** Privacy of the content being shown — the modal's colour. */
  grade: PrivacyGrade;
}) => {
  const style = PRIVACY[grade];
  const contentRef = useRef<HTMLDivElement>(null);
  const last = urls.length - 1;
  const prev = Math.max(0, index - 1);
  const next = Math.min(last, index + 1);
  const step = (dir: -1 | 1) => onIndex(Math.min(last, Math.max(0, index + dir)));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        style={{ backgroundColor: style.bg, color: style.fg }}
        className="flex max-h-[92dvh] max-w-[calc(100vw-2rem)] flex-col items-center gap-0 overflow-hidden rounded-sm border-0 p-4 pt-11 sm:max-w-5xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
      >
        <DialogTitle className="sr-only">{alt} — image {index + 1} of {urls.length}</DialogTitle>

        <button
          type="button"
          aria-label="close"
          onClick={onClose}
          className="absolute top-2 right-2 flex size-8 cursor-pointer items-center justify-center rounded-sm opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-4" />
        </button>

        <Showing url={urls[index]} alt={alt} />

        {last > 0 && (
          <div className="flex items-center justify-center gap-3 pt-4" data-testid="lightbox-nav">
            <NavButton label="previous image" disabled={index === 0} onClick={() => step(-1)}>
              <ChevronLeft className="size-5" />
            </NavButton>
            <div className="flex items-center gap-2">
              {urls.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`image ${i + 1}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => onIndex(i)}
                  className={cn(
                    'size-2 cursor-pointer rounded-sm bg-current',
                    i === index ? 'opacity-100' : 'opacity-30 hover:opacity-60',
                  )}
                />
              ))}
            </div>
            <NavButton label="next image" disabled={index === last} onClick={() => step(1)}>
              <ChevronRight className="size-5" />
            </NavButton>
          </div>
        )}

        {last > 0 && <Preload url={urls[prev]} />}
        {last > 0 && <Preload url={urls[next]} />}
      </DialogContent>
    </Dialog>
  );
};

/** Ghost arrow — the modal's own colour, no filled background. */
const NavButton = ({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="flex size-8 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:opacity-20"
  >
    {children}
  </button>
);

/** The showing media, modal-sized: full image, or video with controls. */
const Showing = ({ url, alt }: { url: string; alt: string }) => {
  const { url: src, error } = useAsset(url);
  if (!src) {
    return error ? (
      <div className="p-8 font-mono text-xs opacity-70" role="alert">media failed: {error}</div>
    ) : (
      <Loader2 className="size-8 animate-spin opacity-70" aria-label="loading media" />
    );
  }
  if (VIDEO_URL.test(url)) {
    return <video src={src} controls autoPlay className="max-h-[78dvh] max-w-full" />;
  }
  return <img src={src} alt={alt} className="max-h-[78dvh] max-w-full object-contain" />;
};

/** Fetched and decoded ahead of the jump — never displayed. */
const Preload = ({ url }: { url: string }) => {
  const { url: src } = useAsset(url);
  if (!src) return null;
  return <img src={src} alt="" aria-hidden className="hidden" />;
};

/** Click affordance that opens a lightbox — image, avatar, banner. */
export const LightboxTrigger = ({
  label,
  onOpen,
  className,
  children,
}: {
  label: string;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    onClick={onOpen}
    className={cn('block cursor-zoom-in rounded-sm', className)}
  >
    {children}
  </button>
);
