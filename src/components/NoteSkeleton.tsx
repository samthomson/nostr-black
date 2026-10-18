import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PRIVACY, type PrivacyGrade } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/** One note-shaped loading placeholder — the same chrome as a loaded
 * note so nothing shifts when the data lands. The grade picks the
 * surface colour, matching the notes that will replace it. */
export const NoteSkeleton = ({ grade = 'public' }: { grade?: PrivacyGrade }) => (
  <Card className={cn('py-0', PRIVACY[grade].surface)}>
    <CardContent className="flex gap-3 px-4 py-3">
      <Skeleton className={cn('size-8 shrink-0 rounded-sm', PRIVACY[grade].softClass)} />
      <div className="w-full space-y-1.5">
        <Skeleton className={cn('h-2.5 w-20', PRIVACY[grade].softClass)} />
        <Skeleton className={cn('h-2.5 w-full', PRIVACY[grade].softClass)} />
      </div>
    </CardContent>
  </Card>
);

/** A feed while it fetches: nothing on screen yet, so show what's
 *  coming. The one loading pattern for every feed surface. */
export const FeedSkeleton = ({ count = 3, grade = 'public' }: { count?: number; grade?: PrivacyGrade }) => (
  <div className="space-y-3">
    {Array.from({ length: count }, (_, i) => (
      <NoteSkeleton key={i} grade={grade} />
    ))}
  </div>
);

