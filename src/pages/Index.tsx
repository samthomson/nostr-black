import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { LoginArea } from '@/components/auth/LoginArea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const relativeTime = (createdAt: number): string => {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

/** Deduplicate by event id and order newest-first. */
const prepareNotes = (events: NostrEvent[]): NostrEvent[] =>
  [...new Map(events.map((e) => [e.id, e])).values()].sort(
    (a, b) => b.created_at - a.created_at,
  );

const Note = ({ event }: { event: NostrEvent }) => {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name;
  const npub = nip19.npubEncode(event.pubkey);

  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <Avatar className="size-10 shrink-0">
          {metadata?.picture && <AvatarImage src={metadata.picture} />}
          <AvatarFallback>{npub.slice(4, 6).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium truncate">
              {displayName ?? `${npub.slice(0, 10)}…`}
            </span>
            <span className="text-muted-foreground shrink-0">{relativeTime(event.created_at)}</span>
          </div>
          <div className="whitespace-pre-wrap break-words text-sm">{event.content}</div>
        </div>
      </CardContent>
    </Card>
  );
};

/** Logged-out brand page. Placeholder only — no network activity happens logged out. */
const Landing = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
    <h1 className="text-5xl font-bold tracking-tight">nostr.black</h1>
    <p className="text-muted-foreground max-w-md">
      a privacy focused nostr client. private by default — public is the exception.
    </p>
    <LoginArea className="flex" />
  </div>
);

const Index = () => {
  useSeoMeta({
    title: 'nostr.black',
    description: 'a privacy focused nostr client',
  });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();

  // Dev feed: latest kind 1 notes from the app relays. The outbox-model feed
  // (followed authors' NIP-65 relays only) replaces this.
  const { data, isLoading } = useQuery({
    queryKey: ['feed'],
    queryFn: (c) => nostr.query([{ kinds: [1], limit: 50 }], { signal: c.signal }),
    enabled: !!user,
  });

  const notes = useMemo(() => prepareNotes(data ?? []), [data]);

  if (!user) return <Landing />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <span className="font-semibold tracking-tight">nostr.black</span>
          <LoginArea className="max-w-60" />
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-3 p-4">
        {isLoading ? (
          Array.from({ length: 5 }, (_, i) => (
            <Card key={i}>
              <CardContent className="flex gap-3 p-4">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="w-full space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : notes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <p className="text-muted-foreground mx-auto max-w-sm">
                No notes found. Try checking your relay connections or wait a moment for content to
                load.
              </p>
            </CardContent>
          </Card>
        ) : (
          notes.map((event) => <Note key={event.id} event={event} />)
        )}
      </main>
    </div>
  );
};

export default Index;
