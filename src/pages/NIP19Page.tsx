import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { useEvent } from '@/data/hooks/useEvent';
import { Note } from '@/components/Note';
import { Thread } from '@/components/Thread';
import { Shell } from '@/components/Shell';
import { ProfilePage } from '@/pages/Profile';
import type { DecodeResult } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import NotFound from './NotFound';

/** Resolves a decoded pointer to (id, relay hints) for fetching. */
const pointerOf = (
  decoded: DecodeResult,
): { id: string; relays: string[] } | null => {
  if (decoded.type === 'note') return { id: decoded.data, relays: [] };
  if (decoded.type === 'nevent') {
    return { id: decoded.data.id, relays: [...(decoded.data.relays ?? [])] };
  }
  return null;
};

/**
 * Renders a single event by its NIP-19 identifier: fetched from the relay
 * hints embedded in the pointer plus the app's relays, rendered with the
 * same Note component the feed uses.
 */
const EventPage = ({ identifier }: { identifier: string }) => {
  const decoded = nip19.decode(identifier);
  const pointer = pointerOf(decoded);
  const author = decoded.type === 'nevent' ? decoded.data.author : undefined;
  const { event, pending: isLoading } = useEvent(pointer?.id, {
    author,
    hints: pointer?.relays,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex gap-3 p-4">
          <Skeleton className="size-8 shrink-0 rounded-sm" />
          <div className="w-full space-y-1.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-3/5" />
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

  return (
    <div className="space-y-3">
      <Note event={event} linkReplies={false} />
      <Thread parent={event.id} author={event.pubkey} />
    </div>
  );
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
      return <ProfilePage pubkey={decoded.data} />;

    case 'nprofile':
      return <ProfilePage pubkey={decoded.data.pubkey} />;

    case 'note':
    case 'nevent':
      return (
        <Shell>
          <EventPage identifier={identifier} />
        </Shell>
      );

    case 'naddr':
      return (
        <Shell>
          <div>Addressable event placeholder</div>
        </Shell>
      );

    default:
      return <NotFound />;
  }
}
