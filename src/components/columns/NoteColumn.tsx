import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { scheduler } from '@/data/scheduler';
import { Button } from '@/components/ui/button';
import { useEvent } from '@/data/hooks/useEvent';
import { useThread } from '@/data/hooks/useThread';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { usePrivateActions } from '@/hooks/usePrivateActions';
import { SealedReplies } from '@/components/PrivateNote';
import { Note } from '@/components/Note';
import { NoteComposer } from '@/components/NoteComposer';
import { FeedSkeleton, NoteSkeleton } from '@/components/NoteSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import type { ColumnPointer } from './columnsState';
import { useAnchorSpacer, useSpacerRefs } from './useAnchorSpacer';

const MissingNote = () => (
  <Card className="border-dashed">
    <CardContent className="px-6 py-8 text-center">
      <p className="text-muted-foreground text-sm">couldn't find this note on your relays</p>
    </CardContent>
  </Card>
);

/**
 * One opened note as a pane — its REPLIES, the root is not repeated (it
 * is open in the column to the left). Clicking a reply opens the next
 * pane at depth + 1; `anchorId` names the reply the pane to the right
 * pertains to, so it stays lit when this pane dims. The data source
 * switches on the pointer: public notes fetch by id from relays, sealed
 * notes read the conversation the app already decrypted — a rumor id
 * exists on no relay.
 *
 * Dimmed (a pane sits to our right) the column is backdrop: frozen, not
 * scrollable — exactly like the feed column.
 */
export const NoteColumn = ({
  pointer,
  depth,
  anchorId,
  dimmed,
  onOpen,
  onClose,
}: {
  pointer: ColumnPointer;
  /** This pane's index in the stack — replies open at depth + 1. */
  depth: number;
  /** The reply whose pane sits to our right — it stays lit when we dim. */
  anchorId?: string;
  /** A pane sits to our right: backdrop, freeze the scroll. */
  dimmed: boolean;
  onOpen: (pointer: ColumnPointer, depth: number) => void;
  onClose: () => void;
}) => {
  const priv = pointer.private === true;
  const root = useEvent(pointer.id, {
    author: pointer.author,
    hints: pointer.relays,
  });
  const thread = useThread(pointer.id, root.event?.pubkey ?? pointer.author);
  const privFeed = usePrivateFeed();
  const privPost = priv
    ? privFeed.posts.find((p) => p.note.rumor.id === pointer.id)
    : undefined;
  const { reply, react, editReply } = usePrivateActions();

  // A miss is not a verdict (relays back off); re-ask once before the
  // empty state, like the note page does. A ref, not state: the retry is
  // an internal one-shot, nothing renders from it.
  const retried = useRef(false);
  useEffect(() => {
    if (root.event || root.pending || retried.current || priv) return;
    retried.current = true;
    const timer = setTimeout(() => {
      scheduler.want(
        { type: 'event', id: pointer.id, author: pointer.author, hints: pointer.relays },
        'interactive',
      );
    }, 5000);
    return () => clearTimeout(timer);
  }, [root.pending, root.event, pointer, priv]);

  // Same pin contract as the feed column: when the reply this pane's
  // right neighbour pertains to sits too low with too little below it,
  const [scrollerRef, spacerRef] = useSpacerRefs<HTMLDivElement>();
  const spacer = useAnchorSpacer(scrollerRef, spacerRef, !!anchorId, anchorId);

  const threadLoading = priv
    ? privFeed.pending && !privPost
    : thread.pending && thread.children.length === 0;
  const replyCount = priv ? privPost?.replies.length ?? 0 : thread.children.length;

  return (
    <div
      ref={scrollerRef}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-3',
        dimmed && 'overflow-y-hidden',
      )}
    >
      {/* Back and the count, foreground like the replies below — nothing
          else. */}
      <div className="border-border/60 text-foreground sticky top-0 z-10 -mx-3 flex items-center gap-2 border-b bg-background/95 px-2 py-1 backdrop-blur">
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="back">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-sm">
          {threadLoading ? '…' : `${replyCount} comment${replyCount === 1 ? '' : 's'}`}
        </span>
      </div>
      {/* One content child: the FLIP scroll (Note) translates this
          wrapper while the scroller itself is frozen. Top padding keeps
          the first reply near the opened note's offset in the column to
          the left. */}
      <div className="flex flex-col gap-1.5 pt-10">
        {!priv && root.pending && <NoteSkeleton />}
        {!priv && !root.pending && !root.event && <MissingNote />}
        {!priv && root.event && thread.pending && thread.children.length === 0 && (
          <FeedSkeleton count={2} />
        )}
        {priv && privFeed.pending && privFeed.posts.length === 0 && <NoteSkeleton grade="private" />}
        {priv && !privFeed.pending && !privPost && <MissingNote />}

        {!priv && root.event && (
          <>
            <div className="space-y-1.5">
              {thread.children.map((replyEvent) => (
                <Note
                  key={replyEvent.id}
                  event={replyEvent}
                  showContext={false}
                  anchored={anchorId === replyEvent.id}
                  onOpen={() =>
                    onOpen({ id: replyEvent.id, author: replyEvent.pubkey }, depth + 1)
                  }
                />
              ))}
            </div>
            {/* Full pane width — the composer matches the replies above it. */}
            <NoteComposer parent={root.event} />
          </>
        )}
        {priv && privPost && (
          <SealedReplies
            note={privPost.note}
            replies={privPost.replies}
            conversation={privPost.conversation}
            pending={privFeed.pending}
            onReply={reply}
            onReact={(parent, target, emoji) => react(parent, target, privPost.conversation, emoji)}
            onEditReply={editReply}
            anchorId={anchorId}
            onOpenReply={(r) => onOpen({ id: r.rumor.id, private: true }, depth + 1)}
          />
        )}
      </div>
      {/* Deficit spacer: lets a low anchored reply pin to the top. */}
      <div ref={spacerRef} aria-hidden="true" className="shrink-0" style={{ height: spacer }} />
    </div>
  );
};
