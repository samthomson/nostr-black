
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { LoginArea } from '@/components/auth/LoginArea';
import { Note } from '@/components/Note';
import { Shell } from '@/components/Shell';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useOutboxFeed } from '@/hooks/useOutboxFeed';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Logged-out brand page. Placeholder only — no network activity happens logged out. */
const Landing = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
    <h1 className="text-5xl font-bold tracking-tight">nostr.black</h1>
    <div className="text-muted-foreground max-w-md space-y-1">
      <p>nostr.black is a privacy focused nostr client.</p>
      <p>it lets you do what you want,</p>
      <p>but it has an opinion, and guides you with it.</p>
      <p>
        public stuff you do is white, private black.
        <br />
        there's a big grey area inbetween…
      </p>
    </div>
    <LoginArea className="flex" />
    <Link to="/settings" className="text-muted-foreground text-sm underline underline-offset-4">
      settings
    </Link>
  </div>
);

const Feed = () => {
  const { notes, foundOn, isLoading, noFollows, followsNotFound } = useOutboxFeed();
  const emptyCard = (text: string) => (
    <Card className="border-dashed">
      <CardContent className="px-8 py-12 text-center">
        <p className="text-muted-foreground mx-auto max-w-sm">{text}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
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
      ) : noFollows ? (
        emptyCard('not following anyone yet')
      ) : followsNotFound ? (
        emptyCard("couldn't find your follow list — it may not be on your relays")
      ) : notes.length === 0 ? (
        emptyCard('no notes found from the people you follow')
      ) : (
        notes.map((event) => <Note key={event.id} event={event} foundOn={foundOn[event.id]} />)
      )}
    </div>
  );
};

const Index = () => {
  useSeoMeta({
    title: 'nostr.black',
    description: 'a privacy focused nostr client',
  });

  const { user } = useCurrentUser();

  if (!user) return <Landing />;

  return (
    <Shell>
      <Feed />
    </Shell>
  );
};

export default Index;
