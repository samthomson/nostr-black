import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** One note-shaped loading placeholder — the same chrome as a loaded
 * note so nothing shifts when the data lands. */
export const NoteSkeleton = () => (
  <Card className="py-0">
    <CardContent className="flex gap-3 px-4 py-3">
      <Skeleton className="size-8 shrink-0 rounded-sm" />
      <div className="w-full space-y-1.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-full" />
      </div>
    </CardContent>
  </Card>
);

/** A feed while it fetches: nothing on screen yet, so show what's
 *  coming. The one loading pattern for every feed surface. */
export const FeedSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: count }, (_, i) => (
      <NoteSkeleton key={i} />
    ))}
  </div>
);
