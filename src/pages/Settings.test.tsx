import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, nip19 } from 'nostr-tools';
import { Route, Routes } from 'react-router-dom';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import SettingsPage from '@/pages/Settings';
import { useKeystore } from '@/auth/useKeystore';

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

const renderAt = (path: string) => {
  window.history.pushState({}, '', path);
  const nsec = nip19.nsecEncode(generateSecretKey());
  return render(
    <TestApp>
      <Unlock nsec={nsec}>
        <Routes>
          <Route path="/settings/*" element={<SettingsPage />} />
        </Routes>
      </Unlock>
    </TestApp>,
  );
};

describe('SettingsPage', () => {
  it('redirects /settings to the default network section', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'settings' })).toBeTruthy();
    expect(await screen.findByText('your relays — where others find you (NIP-65)')).toBeTruthy();
    expect(window.location.pathname).toBe('/settings/network');
  });

  it('renders network, media, and account panels', async () => {
    renderAt('/settings/network');
    expect(await screen.findByText('your relays — where others find you (NIP-65)')).toBeTruthy();

    const { unmount: u1 } = renderAt('/settings/media');
    expect(await screen.findByText('show images and video')).toBeTruthy();
    u1();

    renderAt('/settings/account');
    expect(await screen.findByText(/logged in as/)).toBeTruthy();
  });

  it('redirects unknown sections to network', async () => {
    renderAt('/settings/not-a-section');
    expect(await screen.findByText('your relays — where others find you (NIP-65)')).toBeTruthy();
    expect(window.location.pathname).toBe('/settings/network');
  });

  it('navigates between sections via the section tabs', async () => {
    const user = userEvent.setup();
    renderAt('/settings/network');
    expect(await screen.findByText('your relays — where others find you (NIP-65)')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'media' }));
    expect(await screen.findByText('show images and video')).toBeTruthy();
    expect(window.location.pathname).toBe('/settings/media');
  });
});
