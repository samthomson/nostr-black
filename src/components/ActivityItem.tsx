import type { NostrEvent } from '@nostrify/nostrify';
import { Card, CardContent } from '@/components/ui/card';
import { formatTimestamp } from '@/lib/format';

const LABEL: Record<number, string> = {
  0: 'updated their profile',
  3: 'updated their following',
  10002: 'updated their relays',
};

/** One replaceable activity event in the profile timeline. */
export const ActivityItem = ({ event }: { event: NostrEvent }) => (
  <Card className="bg-privacy-public text-privacy-private py-0">
    <CardContent className="flex items-baseline gap-2 px-4 py-3">
      <span className="truncate text-sm font-semibold">{LABEL[event.kind] ?? `kind ${event.kind}`}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{formatTimestamp(event.created_at)}</span>
    </CardContent>
  </Card>
);
