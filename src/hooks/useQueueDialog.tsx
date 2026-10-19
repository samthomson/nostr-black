import { useBroadcastQueue } from '@/hooks/useBroadcastQueue';
import { useState } from 'react';
import { BroadcastQueueDialog } from '@/components/BroadcastQueueDialog';
import { sentEntries } from '@/data/publish/queue';

/** Status-bar entry point: the queued count, clickable into the queue.
 * Stays present while a sent log remains, so recent deliveries stay
 * viewable after the queue drains. */
export const useQueueDialog = (): { count: number; element: React.ReactNode } => {
  const queue = useBroadcastQueue();
  const [open, setOpen] = useState(false);
  const count = queue.length;
  const visible = count > 0 || sentEntries().length > 0;
  return {
    count,
    element: visible ? (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-yellow-600"
        >
          {count} queued
        </button>
        <BroadcastQueueDialog open={open} onOpenChange={setOpen} />
      </>
    ) : null,
  };
};
