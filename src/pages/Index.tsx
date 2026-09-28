import { useSeoMeta } from '@unhead/react';
import { Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { MovingBackground } from '@/components/MovingBackground';
import { PrivacyTag } from '@/components/PrivacyTag';
import { LoginForm } from '@/components/auth/LoginForm';
import { Button } from '@/components/ui/button';
import { useIsTor } from '@/hooks/useEgress';
import { grantClearnetConsent } from '@/lib/torConsent';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/useTransport';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Feed } from '@/components/Feed';
import { Shell } from '@/components/Shell';
import { TorGate } from '@/components/TorGate';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type Step = 'start' | 'tor' | 'login';

/** Smooth height morph as wizard step content changes size. */
const AnimateHeight = ({ children }: { children: ReactNode }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-in-out"
      style={{ height: height !== undefined ? height : 'auto' }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

/**
 * Logged-out landing: a three-step wizard in one container — start →
 * tor detection → login options — flowing straight into the app. On tor
 * (or desktop, tor by construction) the tor step resolves itself and
 * advances immediately, so the progress marks it skipped.
 */
const Landing = () => {
  const [step, setStep] = useState<Step>('start');
  const onTor = useIsTor();
  const desktop = useIsDesktop();
  const skippedTor = desktop || onTor === true;

  // On tor the tor step is a no-op: render the login step directly.
  const activeStep: Step = step === 'tor' && onTor === true ? 'login' : step;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <MovingBackground />
      {/* Soft scrim so the copy reads over the animated grid without a
          hard container — the grid fades toward the text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(closest-side at 50% 46%, hsla(240, 5%, 12%, 0.92) 0%, hsla(240, 5%, 12%, 0.55) 55%, transparent 100%)',
        }}
      />

      <div className="relative z-10 isolate flex w-full max-w-sm flex-col items-center gap-6">
        <h1 className="text-4xl font-bold"><BrandMark /></h1>

        <div className="text-muted-foreground w-full space-y-1 text-center text-base">
          <p>nostr.black is a privacy focused nostr client.</p>
          <p>it lets you do what you want,</p>
          <p>but it has an opinion, and guides you with it.</p>
          <p>
            <PrivacyTag grade="public" /> stuff you do is white,{' '}
            <PrivacyTag grade="private" /> black.
            <br />
            there's a big <PrivacyTag grade="medium">grey area</PrivacyTag> inbetween…
          </p>
        </div>

        <div className="w-full rounded-sm border bg-card p-6 shadow-lg">
          <AnimateHeight>
            {activeStep === 'start' && (
              <div className="flex justify-center">
                <Button
                  className="rounded-sm"
                  onClick={() => setStep(skippedTor ? 'login' : 'tor')}
                >
                  start
                </Button>
              </div>
            )}

            {activeStep === 'tor' && (
              <div className="flex flex-col items-center gap-4">
                {onTor === undefined && (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    checking your connection…
                  </p>
                )}
                {onTor === false && (
                  <>
                    <p className="text-muted-foreground text-sm">
                      can't confirm you're on tor. nostr.black protects your ip from relays
                      by routing everything through tor.
                    </p>
                    <Button
                      variant="privacy"
                      onClick={() => {
                        grantClearnetConsent();
                        setStep('login');
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
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setStep('start')}
                  className="text-muted-foreground text-xs underline underline-offset-4"
                >
                  ← back
                </button>
              </div>
            )}

            {activeStep === 'login' && (
              <div className="flex flex-col items-center gap-4">
                <LoginForm onDone={() => {/* useCurrentUser flips the page into the app */}} />
                <button
                  type="button"
                  onClick={() => setStep(skippedTor ? 'start' : 'tor')}
                  className="text-muted-foreground text-xs underline underline-offset-4"
                >
                  ← back
                </button>
              </div>
            )}
          </AnimateHeight>
        </div>
      </div>
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
    <TorGate>
      <Shell>
        <Feed />
      </Shell>
    </TorGate>
  );
};

export default Index;
