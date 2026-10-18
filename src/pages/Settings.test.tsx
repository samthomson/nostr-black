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

  it('renders network, media, privacy, and account panels', async () => {
    renderAt('/settings/network');
    expect(await screen.findByText('your relays — where others find you (NIP-65)')).toBeTruthy();

    const { unmount: u1 } = renderAt('/settings/media');
    expect(await screen.findByText('compress images on upload')).toBeTruthy();
    u1();

    const { unmount: u2 } = renderAt('/settings/privacy');
    expect(await screen.findByText('show images and video')).toBeTruthy();
    u2();

    renderAt('/settings/account');
    expect(await screen.findByText(/logged in as/)).toBeTruthy();
  });

  it('privacy panel holds the media gate and the disabled exif strip todo', async () => {
    renderAt('/settings/privacy');
    const toggle = await screen.findByLabelText('show images and video');
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();

    const exif = screen.getByLabelText(/strip image metadata on upload/);
    expect(exif).not.toBeChecked();
    expect(exif).toBeDisabled();
    expect(screen.getByText('(todo)')).toBeTruthy();
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

    await user.click(screen.getByRole('link', { name: 'privacy' }));
    expect(await screen.findByText('show images and video')).toBeTruthy();
    expect(window.location.pathname).toBe('/settings/privacy');
  });
});
