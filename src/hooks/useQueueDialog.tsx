import { useBroadcastQueue } from '@/hooks/useBroadcastQueue';
import { useState } from 'react';
import { BroadcastQueueDialog } from '@/components/BroadcastQueueDialog';

/** Status-bar entry point: the queued count, clickable into the queue. */
export const useQueueDialog = (): { count: number; element: React.ReactNode } => {
  const queue = useBroadcastQueue();
  const [open, setOpen] = useState(false);
  const count = queue.length;
  return {
    count,
    element: count > 0 ? (
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
