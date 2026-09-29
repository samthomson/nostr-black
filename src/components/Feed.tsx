import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { Note } from '@/components/Note';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeed } from '@/data/hooks/useFeed';
import { useProvenance } from '@/data/hooks/useProvenance';
import { useVisibility } from '@/data/hooks/useVisibility';

/**
 * The feed: your follows' notes as sealed pages, newest first.
 *
 * Pages never reorder once shown. Notes that arrive while you read are
 * buffered behind a control rather than spliced in around you, and
 * accepting them keeps the note you were reading exactly where it was.
 */
export const Feed = () => {
  const {
    notes, pending, loading, exhausted, isLoading, noFollows, followsNotFound,
    loadMore, acceptPending,
  } = useFeed();

  // Accepting buffered notes inserts them above the viewport, which pushes
  // everything down by exactly the height added. Measuring before and
  // correcting after cancels that out: the note being read stays under the
  // reader's eyes and the new material stacks above, to scroll up to.
  const heightBeforeAccept = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (heightBeforeAccept.current === null) return;
    const grew = document.documentElement.scrollHeight - heightBeforeAccept.current;
    heightBeforeAccept.current = null;
    if (grew > 0) window.scrollBy(0, grew);
  }, [notes.length]);

  // At the top there is no reading position to preserve — hold-back is
  // only for notes that would jump the viewport while you are mid-feed.
  useEffect(() => {
    if (pending.length === 0) return;
    const maybe = () => {
      if (window.scrollY <= 48) acceptPending();
    };
    maybe();
    window.addEventListener('scroll', maybe, { passive: true });
    return () => window.removeEventListener('scroll', maybe);
  }, [pending.length, acceptPending]);

  const accept = () => {
    heightBeforeAccept.current = document.documentElement.scrollHeight;
    acceptPending();
  };

  const emptyCard = (text: string) => (
    <Card className="border-dashed">
      <CardContent className="px-8 py-12 text-center">
        <p className="text-muted-foreground mx-auto max-w-sm">{text}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {pending.length > 0 && (
        <NewNotes count={pending.length} onAccept={accept} />
      )}

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
        <FeedNote key={event.id} event={event} />
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

      {notes.length > 0 && !exhausted && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-sm border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          {loading ? 'loading…' : 'load older notes'}
        </button>
      )}
      {notes.length > 0 && exhausted && (
        <p className="px-1 py-2 text-center text-xs text-muted-foreground">
          nothing older on their relays
        </p>
      )}

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

/** One note, with the provenance the store recorded when it arrived. */
const FeedNote = ({ event }: { event: React.ComponentProps<typeof Note>['event'] }) => {
  const { foundOn, route } = useProvenance(event.id);
  const visible = useVisibility(event);
  return (
    <div ref={visible}>
      <Note event={event} foundOn={foundOn} route={route} />
    </div>
  );
};

const NewNotes = ({ count, onAccept }: { count: number; onAccept: () => void }) => (
  <button
    type="button"
    onClick={onAccept}
    className="sticky top-0 z-20 flex w-full items-center justify-center gap-1.5 rounded-sm border bg-background/95 px-3 py-2 text-xs font-medium backdrop-blur hover:bg-accent"
  >
    <ArrowUp className="size-3.5" />
    show {count} new {count === 1 ? 'note' : 'notes'}
  </button>
);
