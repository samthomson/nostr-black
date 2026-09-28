import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Puzzle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useKeystore } from '@/auth/useKeystore';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

export interface LoginFormProps {
  /** Called after any successful login. */
  onDone: () => void;
}

type Method = 'extension' | 'signer' | 'nsec';

const METHODS: { id: Method; label: string }[] = [
  { id: 'extension', label: 'extension' },
  { id: 'signer', label: 'signer' },
  { id: 'nsec', label: 'nsec' },
];

const connectStatusLabel = (status: NostrConnectStatus | null): string => {
  switch (status) {
    case 'awaiting-connect':
      return 'Waiting for signer connection…';
    case 'getting-public-key':
      return 'Getting public key…';
    default:
      return '';
  }
};


/**
 * Login form. Signer-first: NIP-07 browser extension, NIP-46 bunker URI,
 * or a nostrconnect remote signer app. The nsec option is memory-only —
 * the key lives in the keystore for this session and is never written to
 * disk (see src/auth/keystore.ts). Renders inline — the dialog and the
 * landing wizard are both thin wrappers around it.
 */
export const LoginForm: React.FC<LoginFormProps> = ({ onDone }) => {
  const [method, setMethod] = useState<Method>('extension');
  const [bunkerInput, setBunkerInput] = useState('');
  const [nsecInput, setNsecInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Nostrconnect ("Open signer app") state. No QR code is shown — the URI is
  // launched directly on the device and the app listens for the handshake.
  const [nostrConnectParams, setNostrConnectParams] = useState<NostrConnectParams | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Progress status for the nostrconnect handshake. `null` means the user
  // hasn't launched the signer yet (or they canceled).
  const [connectStatus, setConnectStatus] = useState<NostrConnectStatus | null>(null);
  // Whether the user has launched the signer app. Until then we show the
  // login form; once launched we swap in the progress view.
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);

  const login = useLoginActions();
  const keystore = useKeystore();
  // Stable refs so the nostrconnect listening effect below doesn't restart on
  // every parent render. Parents typically pass inline arrow functions for
  // onClose, and useLoginActions returns a fresh object each render — without
  // stable refs, an effect depending on them would tear down an in-flight
  // subscription on every render and cause approved logins to be swallowed.
  const loginRef = useRef(login);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Generate a nostrconnect session and return its URI. The listening effect
  // (keyed on the params) handles the handshake once params are set.
  const generateConnectSession = useCallback((): string => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const uri = generateNostrConnectURI(params, {
      callback: isMobile ? `${window.location.origin}/remoteloginsuccess` : undefined,
    });
    setNostrConnectParams(params);
    return uri;
  }, [login]);

  // Start listening for a nostrconnect response once params are set.
  //
  // Deps are intentionally limited to `nostrConnectParams` so that parent
  // re-renders do NOT tear down an in-flight subscription. Cancellation is
  // handled explicitly by the `isOpen` effect (on dialog close) and by
  // handleConnectRetry() (on user cancel/retry).
  useEffect(() => {
    if (!nostrConnectParams) return;

    const startListening = async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await loginRef.current.nostrconnect(
          nostrConnectParams,
          controller.signal,
          (status) => {
            if (controller.signal.aborted) return;
            setConnectStatus(status);
          },
        );
        if (controller.signal.aborted) return;
        onDoneRef.current();
      } catch (error) {
        // AbortError means we intentionally aborted (dialog closed or retry)
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Nostrconnect failed:', error);
        setConnectStatus(null);
        setConnectError(error instanceof Error ? error.message : String(error));
      }
    };

    startListening();
    // No cleanup here: we do NOT want a re-render-triggered effect teardown
    // to cancel the in-flight subscription.
  }, [nostrConnectParams]);

  const handleConnectRetry = useCallback(() => {
    abortControllerRef.current?.abort();
    setNostrConnectParams(null);
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
  }, []);

  // Launch a remote signer app via nostrconnect. Generates the session and
  // navigates to the URI; the listening effect handles the handshake.
  const handleOpenSignerApp = () => {
    setLoginError('');
    setHasOpenedSigner(true);
    window.location.href = generateConnectSession();
  };

  // Login with a NIP-07 browser extension.
  const handleExtensionLogin = async () => {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      await login.extension();
      onDone();
    } catch (error) {
      console.error('Extension login failed:', error);
      setLoginError(
        error instanceof Error
          ? `Extension login failed: ${error.message}`
          : 'Extension login failed. Is a NIP-07 signer installed?',
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Login with a NIP-46 bunker URI.
  const handleBunkerLogin = () => {
    const value = bunkerInput.trim();
    if (!value.startsWith('bunker://')) {
      setLoginError('Enter a bunker://… URI.');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');
    login
      .bunker(value)
      .then(() => onDone())
      .catch(() => {
        setLoginError('Failed to connect. Check the bunker URI.');
        setIsLoggingIn(false);
      });
  };

  // Memory-only nsec login: unlock the keystore for this session.
  const handleNsecLogin = () => {
    try {
      keystore.login(nsecInput);
      onDone();
    } catch {
      setLoginError('Invalid key — expected nsec1…');
    }
  };

  // Once the user launches the signer app we replace the login form with a
  // progress view so they see feedback while the handshake completes.
  const showProgressView = hasOpenedSigner;

  return (
    <div className="w-full max-w-sm space-y-4">
          {connectError ? (
            <div className="flex flex-col items-center space-y-3 py-4">
              <p className="text-sm text-destructive text-center">{connectError}</p>
              <Button variant="outline" onClick={handleConnectRetry} className="rounded-sm">
                Try again
              </Button>
            </div>
          ) : showProgressView ? (
            <div className="flex flex-col items-center space-y-4 py-6 w-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center min-h-[1.25rem]">
                {connectStatusLabel(connectStatus) || 'Waiting for your signer…'}
              </p>
              <button
                type="button"
                onClick={handleConnectRetry}
                className="text-sm text-primary hover:underline underline-offset-4 font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="login method"
                className="flex gap-1 rounded-sm border p-0.5"
              >
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={method === m.id}
                    onClick={() => {
                      setMethod(m.id);
                      setLoginError('');
                    }}
                    className={cn(
                      'flex-1 rounded-sm px-2 py-1 text-xs transition-colors',
                      method === m.id
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {method === 'extension' && (
                <div className="flex flex-col items-center gap-3">
                  <Button
                    variant="privacy"
                    onClick={handleExtensionLogin}
                    disabled={isLoggingIn}
                    className={cn(PRIVACY_BUTTON, PRIVACY.high.className)}
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Puzzle className="w-4 h-4" />
                    )}
                    log in with extension
                  </Button>
                  {loginError && <p className="text-sm text-destructive text-center">{loginError}</p>}
                </div>
              )}

              {method === 'signer' && (
                <div className="flex flex-col items-center gap-3">
                  <form
                    className="flex w-full flex-col items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleBunkerLogin();
                    }}
                  >
                    <Input
                      value={bunkerInput}
                      onChange={(e) => setBunkerInput(e.target.value)}
                      placeholder="bunker://…"
                      className="font-mono"
                      aria-label="Bunker URI"
                    />
                    {loginError && <p className="text-sm text-destructive text-center">{loginError}</p>}
                    <Button
                      type="submit"
                      variant="privacy"
                      disabled={isLoggingIn}
                      className={cn(PRIVACY_BUTTON, PRIVACY.medium.className)}
                    >
                      log in with bunker
                    </Button>
                  </form>
                  <button
                    type="button"
                    onClick={handleOpenSignerApp}
                    className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
                  >
                    <ExternalLink className="size-3" />
                    open signer app
                  </button>
                </div>
              )}

              {method === 'nsec' && (
                <form
                  className="flex flex-col items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleNsecLogin();
                  }}
                >
                  <Input
                    type="password"
                    value={nsecInput}
                    onChange={(e) => setNsecInput(e.target.value)}
                    placeholder="nsec1… (session only)"
                    className="font-mono"
                    aria-label="Secret key"
                    autoComplete="off"
                  />
                  {loginError && <p className="text-sm text-destructive text-center">{loginError}</p>}
                  <Button
                    type="submit"
                    variant="privacy"
                    disabled={isLoggingIn}
                    className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
                  >
                    log in — this session only
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    kept in memory, never written to disk, cleared when you close the app
                  </p>
                </form>
              )}
            </>
          )}
    </div>
  );
};
