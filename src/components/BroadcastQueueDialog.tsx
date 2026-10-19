import { useState } from 'react';
import { ChevronDown, RefreshCw, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBroadcastQueue } from '@/hooks/useBroadcastQueue';
import type { NostrEvent } from '@nostrify/nostrify';
import { dismiss, retryAll, retryBroadcast, sentEntries } from '@/data/publish/queue';
import { RelayPill } from '@/components/Pills';
import { formatTimestamp } from '@/lib/format';
import { JsonBlock } from '@/components/EventInfoDialog';
import { cn } from '@/lib/utils';

/**
 * One expandable row body: the note's text at a glance, the raw signed
 * event one toggle deeper. The chevron lives on the row; this renders
 * below it when open.
 */
const Expandable = ({ content, event }: { content: string; event: NostrEvent }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground flex w-full cursor-pointer items-center gap-1 text-left text-xs hover:text-foreground"
      >
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')} />
        {open ? 'hide note' : 'show note'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {content && <p className="break-words whitespace-pre-wrap">{content}</p>}
          <JsonBlock value={event} />
        </div>
      )}
    </div>
  );
};

/**
 * The broadcast queue viewer: what is pending, what failed, why — retry
 * or discard — plus the last five delivered broadcasts (what went where,
 * when). Successes leave the queue on arrival; the sent log is how they
 * stay visible. Opened from the status bar's queued count.
 */
export const BroadcastQueueDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queue = useBroadcastQueue();
  const sent = sentEntries();
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
          {queue.length === 0 && sent.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              nothing queued — broadcasts leave on success
            </p>
          )}
          <ul className="space-y-1">
            {queue.map((entry) => (
              <li key={entry.id} className="rounded-sm border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={entry.status === 'failed' ? 'text-red-500' : 'text-yellow-600'}>
                    {entry.status === 'failed' ? 'failed' : 'queued'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.label}
                    {entry.error && (
                      <span className="text-muted-foreground block truncate text-xs">{entry.error}</span>
                    )}
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {entry.relays.map((url) => <RelayPill key={url} url={url} />)}
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
                </div>
                <Expandable content={entry.event.content} event={entry.event} />
              </li>
            ))}
          </ul>
          {sent.length > 0 && (
            <div className="pt-3">
              <p className="text-muted-foreground pb-1 text-xs">sent</p>
              <ul className="space-y-1">
                {sent.map((entry) => (
                  <li key={entry.id} className="rounded-sm border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {entry.label}
                        <span className="flex min-w-0 flex-wrap gap-1">
                          {entry.relays.map((url) => <RelayPill key={url} url={url} />)}
                        </span>
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-xs">
                        {formatTimestamp(Math.floor(entry.sentAt / 1000))}
                      </span>
                    </div>
                    <Expandable content={entry.event.content} event={entry.event} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

