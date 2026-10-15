import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, nip19 } from 'nostr-tools';
import AuthDialog from './AuthDialog';
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { flushSession } from '@/auth/keystore';

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const renderDialog = () =>
  render(
    <KeystoreProvider>
      <AuthDialog isOpen onClose={() => undefined} />
    </KeystoreProvider>,
  );

describe('AuthDialog', () => {
  it.beforeEach?.(() => flushSession());

  it('logs in with an nsec and remembers it on this device', async () => {
    const user = userEvent.setup();
    renderDialog();

    const field = await screen.findByLabelText(/secret key/i);
    await user.type(field, nip19.nsecEncode(generateSecretKey()));
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(localStorage.getItem('keystore.nsec')).toBeTruthy();
  });

  it('rejects garbage with an explicit error', async () => {
    const user = userEvent.setup();
    renderDialog();

    const field = await screen.findByLabelText(/secret key/i);
    await user.type(field, 'not-a-key');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/invalid key/i)).toBeTruthy();
    expect(localStorage.getItem('keystore.nsec')).toBeNull();
  });
});
