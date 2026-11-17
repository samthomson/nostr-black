import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one loading affordance: a spinner centred where content is
 * coming, an optional muted caption beneath. Every surface that loads
 * — feeds, threads, referenced notes, media — shows this; nothing
 * ships skeleton cards.
 */
export const Loading = ({ text, className }: { text?: string; className?: string }) => (
  <div className={cn('flex flex-col items-center justify-center gap-2 py-10', className)}>
    <Loader2 aria-hidden="true" className="text-muted-foreground size-5 animate-spin" />
    {text && <p className="text-muted-foreground text-xs">{text}</p>}
  </div>
);
