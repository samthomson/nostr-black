import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Puzzle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
}


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
 * Login dialog. nostr.black never touches secret keys: signers only —
 * NIP-07 browser extension, NIP-46 bunker URI, or a nostrconnect remote
 * signer app. There is deliberately no nsec input and no key generation.
 */
const AuthDialog: React.FC<AuthDialogProps> = ({ isOpen, onClose }) => {
  const [bunkerInput, setBunkerInput] = useState('');
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
  // Stable refs so the nostrconnect listening effect below doesn't restart on
  // every parent render. Parents typically pass inline arrow functions for
  // onClose, and useLoginActions returns a fresh object each render — without
  // stable refs, an effect depending on them would tear down an in-flight
  // subscription on every render and cause approved logins to be swallowed.
  const loginRef = useRef(login);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setBunkerInput('');
      setIsLoggingIn(false);
      setLoginError('');
      setNostrConnectParams(null);
      setConnectError(null);
      setConnectStatus(null);
      setHasOpenedSigner(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [isOpen]);

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
        onCloseRef.current();
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
      onClose();
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
      .then(() => onClose())
      .catch(() => {
        setLoginError('Failed to connect. Check the bunker URI.');
        setIsLoggingIn(false);
      });
  };

  // Once the user launches the signer app we replace the login form with a
  // progress view so they see feedback while the handshake completes.
  const showProgressView = hasOpenedSigner;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-0 overflow-hidden rounded-2xl overflow-y-auto">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight text-center">
            Log in
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-5">
          {connectError ? (
            <div className="flex flex-col items-center space-y-3 py-4">
              <p className="text-sm text-destructive text-center">{connectError}</p>
              <Button variant="outline" onClick={handleConnectRetry} className="rounded-full">
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
              <Button
                onClick={handleExtensionLogin}
                disabled={isLoggingIn}
                className="w-full h-12 rounded-full"
              >
                {isLoggingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Puzzle className="w-4 h-4" />
                )}
                Log in with browser extension
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <form
                className="space-y-2"
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
                {loginError && <p className="text-sm text-destructive">{loginError}</p>}
                <Button type="submit" disabled={isLoggingIn} className="w-full h-12 rounded-full">
                  Log in with bunker
                </Button>
              </form>

              <Button
                type="button"
                variant="ghost"
                onClick={handleOpenSignerApp}
                className="w-full rounded-full text-muted-foreground"
              >
                <ExternalLink className="w-4 h-4" />
                Open signer app
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                nostr.black never handles your secret key. Use a signer: a browser extension, a
                bunker, or a remote signer app.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AuthDialog;
