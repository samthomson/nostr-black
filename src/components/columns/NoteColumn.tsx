import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { scheduler } from '@/data/scheduler';
import { Button } from '@/components/ui/button';
import { useEvent } from '@/data/hooks/useEvent';
import { useThread } from '@/data/hooks/useThread';
import { usePrivateFeed, type PrivatePost } from '@/data/hooks/usePrivateFeed';
import { usePrivateActions } from '@/hooks/usePrivateActions';
import { PrivateItem, ReplyComposer } from '@/components/PrivateNote';
import { Note } from '@/components/Note';
import { NoteComposer } from '@/components/NoteComposer';
import { FeedSkeleton, NoteSkeleton } from '@/components/NoteSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import type { ColumnPointer } from './columnsState';
/**
 * One opened note as a pane: the note up top, its replies below, the reply
 * composer at the bottom. Clicking a reply (or its reply count) opens the
 * next pane to the right — depth is this pane's index, so its own old
 * children are replaced. `anchorId` names the reply the pane to the right
 * pertains to: that one stays lit when this pane dims.
 */

const MissingNote = () => (
  <Card className="border-dashed">
    <CardContent className="px-6 py-8 text-center">
      <p className="text-muted-foreground text-sm">couldn't find this note on your relays</p>
    </CardContent>
  </Card>
);

/** Sealed replies: same pane, same Note card — the data comes from the
 *  private conversation instead of relays, and replies keep their
 *  wrapper so they open further private panes. */
const PrivateReplies = ({
  post,
  depth,
  anchorId,
  loading,
  onOpen,
}: {
  post: PrivatePost;
  depth: number;
  anchorId?: string;
  /** True until the private feed's first data lands — counts skeleton. */
  loading: boolean;
  onOpen: (pointer: ColumnPointer, depth: number) => void;
}) => {
  const { reply, react, editReply } = usePrivateActions();
  const { note, conversation } = post;
  return (
    <>
      <div className="space-y-1.5">
        {post.replies.map((r) => (
          <PrivateItem
            key={r.rumor.id}
            rumor={r.rumor}
            wrapper={r.wrapper}
            replyCek={note.replyCek}
            conversation={conversation}
            versions={[...(r.history?.map((h) => h.rumor) ?? []), r.rumor]}
            pending={loading}
            anchored={anchorId === r.rumor.id}
            onOpen={() => onOpen({ id: r.rumor.id, private: true }, depth + 1)}
            onReact={(target, emoji) => react(note, target, conversation, emoji)}
            onEdit={(content) => editReply(note, r, content)}
          />
        ))}
      </div>
      <ReplyComposer parent={note} onReply={reply} />
    </>
  );
};


export const NoteColumn = ({
  pointer,
  depth,
  anchorId,
  onOpen,
  onClose,
}: {
  pointer: ColumnPointer;
  /** This pane's index in the stack — replies open at depth + 1. */
  depth: number;
  /** The reply whose pane sits to our right — it stays lit when we dim. */
  anchorId?: string;
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
  const threadLoading = priv ? privFeed.pending && !privPost : thread.pending && thread.children.length === 0;
  const replyCount = priv ? privPost?.replies.length ?? 0 : thread.children.length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
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
        {priv && privFeed.pending && privFeed.posts.length === 0 && <NoteSkeleton />}
        {priv && !privFeed.pending && !privPost && <MissingNote />}

        {/* No repeated root note in either mode: it is open in the column
            to the left; this pane is its replies. */}
        {!priv && root.event && (
          <>
            <div className="space-y-1.5">
              {thread.children.map((reply) => (
                <Note
                  key={reply.id}
                  event={reply}
                  showContext={false}
                  anchored={anchorId === reply.id}
                  onOpen={() =>
                    onOpen({ id: reply.id, author: reply.pubkey }, depth + 1)
                  }
                />
              ))}
            </div>
            {/* Full pane width — the composer matches the replies above it. */}
            <NoteComposer parent={root.event} />
          </>
        )}
        {priv && privPost && (
          <PrivateReplies
            post={privPost}
            depth={depth}
            anchorId={anchorId}
            loading={privFeed.pending}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
};
