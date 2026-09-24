import { useEffect, useState } from 'react';
import { isTor } from '@/net/net';
import { Button } from '@/components/ui/button';

type GateState = 'checking' | 'allowed' | 'blocked' | 'error';

const OVERRIDE_KEY = 'nostr:tor-override';

/**
 * Web-build network gate. nostr.black warns off-Tor: relays would learn the
 * user's IP. Identical in dev and production — one behavior, no
 * dev/prod divergence. The user is never locked out: they can explicitly
 * continue without tor (eg on a vpn they trust), remembered for the tab
 * session. The desktop build is Tor-by-construction and will not mount
 * this gate.
 */
export const TorGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GateState>(() =>
    window.sessionStorage.getItem(OVERRIDE_KEY) === '1' ? 'allowed' : 'checking',
  );
  const [error, setError] = useState('');

  const runCheck = async () => {
    try {
      setState((await isTor()) ? 'allowed' : 'blocked');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // First setState only happens after the awaited check, keeping the effect
  // free of synchronous setState (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (state === 'checking') {
      /* eslint-disable react-hooks/set-state-in-effect */
      void runCheck();
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const override = () => {
    window.sessionStorage.setItem(OVERRIDE_KEY, '1');
    setState('allowed');
  };

  const retry = () => {
    setState('checking');
    setError('');
    void runCheck();
  };

  if (state === 'allowed') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">checking connection…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <h1 className="text-2xl font-bold">could not verify tor status</h1>
        <p className="text-muted-foreground max-w-md break-all text-sm">{error}</p>
        <div className="flex gap-2">
          <Button onClick={retry} className="rounded-full">
            retry
          </Button>
          <Button variant="ghost" onClick={override} className="rounded-full">
            continue without tor
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">nostr.black</h1>
      <p className="text-muted-foreground max-w-md">
        you're not on tor. nostr.black protects your ip from relays by routing
        everything through tor.
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
