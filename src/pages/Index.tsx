import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { LoginArea } from '@/components/auth/LoginArea';
import { Feed } from '@/components/Feed';
import { Shell } from '@/components/Shell';
import { useCurrentUser } from '@/hooks/useCurrentUser';

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
