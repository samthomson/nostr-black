import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { generateSecretKey, nip19 } from 'nostr-tools';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { AuthGate } from '@/components/AuthGate';
import { useKeystore } from '@/auth/useKeystore';
import { grantClearnetConsent } from '@/lib/torConsent';

/** Logs in once and exposes the keystore — login/logout are stable. */
let ks: { login: (n: string) => string; logout: () => void; unlocked: boolean } | undefined;
let everLoggedIn = false;
const Probe = ({ nsec, children }: { nsec?: string; children: ReactNode }) => {
  const keystore = useKeystore();
  useLayoutEffect(() => {
    ks = keystore;
    if (nsec && !keystore.unlocked && !everLoggedIn) {
      everLoggedIn = true;
      keystore.login(nsec);
    }
  }, [keystore, nsec]);
  if (nsec && !everLoggedIn && !keystore.unlocked) return null;
  return children;
};

const ROUTES = (
  <Routes>
    <Route path="/" element={<div>landing</div>} />
    <Route
      path="/private"
      element={
        <AuthGate>
          <div>secret</div>
        </AuthGate>
      }
    />
  </Routes>
);

describe('AuthGate', () => {
  it('redirects logged-out visitors on gated routes to the landing', async () => {
    window.history.pushState({}, '', '/private');
    render(<TestApp>{ROUTES}</TestApp>);

    expect(await screen.findByText('landing')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('an explicit logout never returns the next identity to the previous identity page', async () => {
    grantClearnetConsent();
    everLoggedIn = false;
    const nsec = nip19.nsecEncode(generateSecretKey());
    window.history.pushState({}, '', '/private');
    render(
      <TestApp>
        <Probe nsec={nsec}>{ROUTES}</Probe>
      </TestApp>,
    );
    await screen.findByText('secret');

    act(() => {
      ks!.logout();
    });
    await screen.findByText('landing');

    // No return path is recorded: the next login lands on the feeds,
    // never the previous identity's page.
    expect(window.history.state?.usr?.from).toBeUndefined();
  });
});
