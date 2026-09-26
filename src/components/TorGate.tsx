import { useEffect, useState } from 'react';
import { isTor } from '@/net/net';
import { Button } from '@/components/ui/button';

/**
 * Web-build network gate. nostr.black warns when it can't confirm Tor:
 * relays would learn the user's IP. Identical in dev and production, and
 * re-checked on every load — the override is per-page-view only, never
 * persisted (a settings toggle to skip the check may come later). The
 * desktop build is Tor-by-construction and will not mount this gate.
 */
export const TorGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<'checking' | 'allowed' | 'blocked'>('checking');

  useEffect(() => {
    if (state !== 'checking') return;
    let cancelled = false;
    void isTor().then((onTor) => {
      if (!cancelled) setState(onTor ? 'allowed' : 'blocked');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'allowed') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <h1 className="animate-pulse text-2xl font-bold tracking-tight">nostr.black</h1>
        <p className="text-muted-foreground text-sm">connecting…</p>
      </div>
    );
  }

  const override = () => {
    setState('allowed');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">nostr.black</h1>
      <p className="text-muted-foreground max-w-md">
        can't confirm you're on tor. nostr.black protects your ip from relays
        by routing everything through tor.
      </p>
      <div className="flex flex-col items-center gap-3">
        <Button asChild className="rounded-full">
          <a href="https://www.torproject.org/download/" rel="noopener noreferrer" target="_blank">
            get tor browser
          </a>
        </Button>
        <Button variant="ghost" onClick={override} className="rounded-full text-muted-foreground">
          continue without tor (my ip, my choice)
        </Button>
        <p className="text-muted-foreground text-xs">desktop app with bundled tor — coming soon</p>
      </div>
    </div>
  );
};
