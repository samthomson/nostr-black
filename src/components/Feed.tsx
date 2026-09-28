import { Loader2 } from 'lucide-react';
import { Note } from '@/components/Note';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOutboxFeed } from '@/hooks/useOutboxFeed';

/**
 * The feed: your follows' notes, merged newest-first as relay waves land.
 * States, in order: loading (skeletons, then live notes + spinner banner),
 * then the specific empty verdicts (no follows / list not found / nothing
 * from them).
 */
export const Feed = () => {
  const { notes, foundOn, foundRoute, isLoading, noFollows, followsNotFound } = useOutboxFeed();

  const emptyCard = (text: string) => (
    <Card className="border-dashed">
      <CardContent className="px-8 py-12 text-center">
        <p className="text-muted-foreground mx-auto max-w-sm">{text}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <Loader2 className="size-3.5 animate-spin" />
          fetching events{notes.length > 0 ? ` — ${notes.length} so far` : '…'}
        </div>
      )}
      {!isLoading && notes.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">{notes.length} notes</p>
      )}
      {notes.map((event) => (
        <Note
          key={event.id}
          event={event}
          foundOn={foundOn[event.id]}
          route={foundRoute[event.id]}
        />
      ))}
      {isLoading &&
        Array.from({ length: notes.length > 0 ? 2 : 5 }, (_, i) => (
          <Card key={`s${i}`}>
            <CardContent className="flex gap-3 p-4">
              <Skeleton className="size-8 shrink-0 rounded-sm" />
              <div className="w-full space-y-1.5">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-3/5" />
              </div>
            </CardContent>
          </Card>
        ))}
      {/* Verdicts only when there's nothing to show — a transient empty
          refetch must never wipe a feed that's on screen. */}
      {!isLoading && notes.length === 0 && noFollows &&
        emptyCard('not following anyone yet')}
      {!isLoading && notes.length === 0 && followsNotFound &&
        emptyCard("couldn't find your follow list — it may not be on your relays")}
      {!isLoading && notes.length === 0 && !noFollows && !followsNotFound &&
        emptyCard('no notes found from the people you follow')}
    </div>
  );
};
