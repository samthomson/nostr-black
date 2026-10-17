import { useState } from 'react';
import { useIsTor } from '@/hooks/useEgress';
import { Button } from '@/components/ui/button';
import { grantClearnetConsent, hasClearnetConsent } from '@/lib/torConsent';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/** The tor warning content: reused by the full-page gate (logged-in app)
 * and inline on the landing (logged-out) — one copy, two surfaces. */
export const GateNotice = ({ onOverride }: { onOverride: () => void }) => (
  <div className="flex flex-col items-center gap-3">
    <p className="text-muted-foreground max-w-md">
      can't confirm you're on tor. nostr.black protects your ip from relays
      by routing everything through tor.
    </p>
    <div className="flex flex-col items-center gap-2">
        <Button
          variant="privacy"
          onClick={() => {
            grantClearnetConsent();
            onOverride();
          }}
        className={cn(
          PRIVACY_BUTTON,
          'h-auto flex-col gap-0.5 py-1.5',
          PRIVACY.public.className,
        )}
      >
        <span>continue without tor</span>
        <span className="text-[10px] font-normal leading-none opacity-70">
          (my ip, my choice)
        </span>
      </Button>
      <a
        href="https://www.torproject.org/download/"
        rel="noopener noreferrer"
        target="_blank"
        className="text-muted-foreground text-xs underline underline-offset-4"
      >
        get tor browser
      </a>
    </div>
  </div>
);

/**
 * Web-build network gate for the authenticated app. nostr.black warns when
 * it can't confirm Tor: relays would learn the user's IP. Identical in dev
 * and production. The probe is once per tab; clearnet override is session
 * storage so feed ↔ profile does not re-show this splash. A new tab re-asks.
 * The desktop build is tor-by-construction (or explicitly toggled to
 * clearnet) and never mounts this gate. The logged-out landing embeds
 * GateNotice instead — no double homepage.
 */
export const TorGate = ({ children }: { children: React.ReactNode }) => {
  const onTor = useIsTor();
  const [override, setOverride] = useState(false);

  if (override || onTor === true || hasClearnetConsent()) return <>{children}</>;

  if (onTor === undefined) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <h1 className="animate-pulse text-2xl font-bold tracking-tight">nostr.black</h1>
        <p className="text-muted-foreground text-sm">connecting…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">nostr.black</h1>
      <GateNotice onOverride={() => setOverride(true)} />
    </div>
  );
};
