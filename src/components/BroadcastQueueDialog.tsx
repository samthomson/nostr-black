import { RefreshCw, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBroadcastQueue } from '@/hooks/useBroadcastQueue';
import { dismiss, retryAll, retryBroadcast } from '@/data/publish/queue';
import { hostOf } from '@/lib/format';

/**
 * The broadcast queue viewer: what is pending, what failed, why — retry
 * or discard. Successes never appear; they leave the queue on arrival.
 * Opened from the status bar's queued count.
 */
export const BroadcastQueueDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queue = useBroadcastQueue();
  const failed = queue.filter((entry) => entry.status === 'failed');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-2 px-4 pt-4 pb-3">
          <DialogTitle className="text-sm leading-none font-semibold tracking-tight">
            broadcast queue
          </DialogTitle>
          {failed.length > 0 && (
            <button
              type="button"
              onClick={() => retryAll()}
              className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-1 text-xs hover:text-foreground"
            >
              <RefreshCw className="size-3" />
              retry all
            </button>
          )}
        </DialogHeader>

        <div className="max-h-[calc(85dvh-6rem)] overflow-y-auto px-4 pb-4">
          {queue.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              nothing queued — broadcasts leave on success
            </p>
          )}
          <ul className="space-y-1">
            {queue.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 rounded-sm border p-2 text-sm">
                <span className={entry.status === 'failed' ? 'text-red-500' : 'text-yellow-600'}>
                  {entry.status === 'failed' ? 'failed' : 'queued'}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.label}
                  {entry.error && (
                    <span className="text-muted-foreground block truncate text-xs">{entry.error}</span>
                  )}
                  <span className="text-muted-foreground block truncate font-mono text-xs">
                    {entry.relays.map(hostOf).join(', ')}
                  </span>
                </span>
                {entry.status === 'failed' && (
                  <button
                    type="button"
                    aria-label="retry broadcast"
                    onClick={() => retryBroadcast(entry.id)}
                    className="text-muted-foreground cursor-pointer rounded-sm px-1.5 py-1 hover:bg-accent"
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="discard broadcast"
                  onClick={() => dismiss(entry.id)}
                  className="text-muted-foreground cursor-pointer rounded-sm px-1.5 py-1 hover:bg-accent"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
};

