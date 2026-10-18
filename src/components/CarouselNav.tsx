import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NavButton } from '@/components/Lightbox';
import { cn } from '@/lib/utils';

/**
 * Carousel navigation — ghost chevrons and square dots, the same chrome
 * as the lightbox's own navigation. Shared by the public note's media
 * carousel and the private one.
 */
export const CarouselNav = ({ count, index, onIndex }: { count: number; index: number; onIndex: (i: number) => void }) => (
  <div className="flex items-center justify-center gap-3 pt-1" data-testid="carousel-nav">
    <NavButton label="previous image" disabled={index === 0} onClick={() => onIndex(index - 1)}>
      <ChevronLeft className="size-5" />
    </NavButton>
    <div className="flex items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
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
    <NavButton label="next image" disabled={index === count - 1} onClick={() => onIndex(index + 1)}>
      <ChevronRight className="size-5" />
    </NavButton>
  </div>
);
