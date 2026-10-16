import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { scheduler } from '@/data/scheduler';
import { useEvent } from '@/data/hooks/useEvent';
import { Note } from '@/components/Note';
import { Thread } from '@/components/Thread';
import { NoteComposer } from '@/components/NoteComposer';
import { Page } from '@/components/Page';
import { ProfilePage } from '@/pages/Profile';
import type { DecodeResult } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { NoteSkeleton } from '@/components/NoteSkeleton';
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
  const [attempt, setAttempt] = useState(0);
  const { event, pending: isLoading } = useEvent(pointer?.id, {
    author,
    hints: pointer?.relays,
  });

  // A miss is not a verdict: relays back off and connections race cold
  // starts, so re-ask twice before showing the empty state.
  useEffect(() => {
    if (!pointer || isLoading || event || attempt >= 2) return;
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      scheduler.want({ type: 'event', id: pointer.id, author, hints: pointer.relays }, 'interactive');
    }, 5000);
    return () => clearTimeout(timer);
  }, [isLoading, event, attempt, author, pointer]);

  if (isLoading) {
    return <NoteSkeleton />;
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
    <div className="space-y-4">
      <Note event={event} linkReplies={false} />
      <Thread parent={event.id} author={event.pubkey} />
      <div className="border-l pl-3">
        <NoteComposer parent={event} />
      </div>
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
        <Page>
          <EventPage identifier={identifier} />
        </Page>
      );

    case 'naddr':
      return (
        <Page>
          <div>Addressable event placeholder</div>
        </Page>
      );

    default:
      return <NotFound />;
  }
}
