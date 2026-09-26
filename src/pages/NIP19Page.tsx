import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DecodeResult } from '@/lib/format';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { queryRelay } from '@/net/relayClient';
import { Note } from '@/components/Note';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import NotFound from './NotFound';
import { readRelays } from '@/lib/appRelays';

/** Resolves a decoded pointer to (id, relay hints) for fetching. */
const pointerOf = (
  decoded: DecodeResult,
): { id: string; relays: string[] } | null => {
  if (decoded.type === 'nevent') {
    return { id: decoded.data.id, relays: [...(decoded.data.relays ?? [])] };
  }
  return null;
};

/**
 * Renders a single event by its NIP-19 identifier: fetched from the relay
 * hints embedded in the pointer plus the app's configured/discovery relays,
 * rendered with the same Note component the feed uses.
 */
const EventPage = ({ identifier }: { identifier: string }) => {
  const { config } = useAppContext();

  const decoded = nip19.decode(identifier);
  const pointer = pointerOf(decoded);
  const relays = pointer
    ? [
        ...new Set([
          ...pointer.relays,
          ...readRelays(config),
          ...config.discoveryRelays,
        ]),
      ]
    : [];

  const { data: event, isLoading } = useQuery({
    queryKey: ['event', pointer?.id, relays.join(',')],
    enabled: !!pointer,
    queryFn: async () => {
      for (const url of relays) {
        const events = await queryRelay(url, [{ ids: [pointer!.id] }]);
        if (events.length > 0) return events[0];
      }
      return null;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex gap-3 p-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!event) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-8 py-12 text-center">
          <p className="text-muted-foreground mx-auto max-w-sm">
            couldn't find that event on your relays or its hints
          </p>
        </CardContent>
      </Card>
    );
  }

  return <Note event={event as NostrEvent} />;
};

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) {
    return <NotFound />;
  }

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  switch (decoded.type) {
    case 'npub':
    case 'nprofile':
      return <div>Profile placeholder</div>;

    case 'note':
    case 'nevent':
      return <EventPage identifier={identifier} />;

    case 'naddr':
      return <div>Addressable event placeholder</div>;

    default:
      return <NotFound />;
  }
}
