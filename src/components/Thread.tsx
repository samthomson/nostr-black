import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Note } from '@/components/Note';
import { useThread } from '@/data/hooks/useThread';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One level of replies under a note. Expanding a child mounts another
 * Thread — depth is the user's clicks, never prefetched.
 */
export const Thread = ({ parent, author }: { parent: string; author?: string }) => {
  const { children, pending } = useThread(parent, author);

  if (pending && children.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i}>
            <CardContent className="flex gap-3 p-4">
              <Skeleton className="size-8 shrink-0 rounded-sm" />
              <div className="w-full space-y-1.5">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (children.length === 0) return null;

  return (
    <div className="space-y-3 border-l pl-3">
      {children.map((event) => (
        <ThreadBranch key={event.id} event={event} />
      ))}
    </div>
  );
};

const ThreadBranch = ({ event }: { event: NostrEvent }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <Note event={event} linkReplies={false} onReplies={() => setOpen((value) => !value)} />
      {open && <Thread parent={event.id} author={event.pubkey} />}
    </div>
  );
};
