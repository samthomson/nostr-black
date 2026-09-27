import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, nip19 } from 'nostr-tools';
import type * as LoginActionsModule from '@/hooks/useLoginActions';

import AuthDialog from './AuthDialog';
import { TestApp } from '@/test/TestApp';

const { mockBunker, mockExtension } = vi.hoisted(() => ({
  mockBunker: vi.fn(),
  mockExtension: vi.fn(),
}));

vi.mock('@/hooks/useLoginActions', async (importOriginal) => {
  const actual = await importOriginal<typeof LoginActionsModule>();
  return {
    ...actual,
    useLoginActions: () => ({
      bunker: mockBunker,
      extension: mockExtension,
      nostrconnect: vi.fn(),
      getRelayUrls: () => ['wss://relay.example'],
    }),
  };
});

const renderDialog = (onClose = vi.fn()) =>
  render(
    <TestApp>
      <AuthDialog isOpen onClose={onClose} />
    </TestApp>,
  );

beforeEach(() => {
  mockBunker.mockReset();
  mockExtension.mockReset();
  window.localStorage.clear();
});

describe('AuthDialog', () => {
  it('offers signer logins only: extension, bunker, signer app', async () => {
    renderDialog();

    expect(
      await screen.findByRole('button', { name: /log in with browser extension/i }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /log in with bunker/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open signer app/i })).toBeTruthy();
  });
  it('the nsec option is memory-only: input present, nothing persisted', async () => {
    renderDialog();
    await screen.findByRole('button', { name: /log in with bunker/i });

    // The privacy contract now: exactly two inputs (bunker URI + session-only
    // nsec), and the nsec path must state its memory-only nature.
    const inputs = document.body.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
    const placeholders = Array.from(inputs).map((i) => (i as HTMLInputElement).placeholder);
    expect(placeholders).toContain('bunker://…');
    expect(placeholders.find((p) => p.includes('session only'))).toBeTruthy();
  });
  it('refuses an nsec pasted into the bunker field', async () => {
    const user = userEvent.setup();
    renderDialog();

    const field = await screen.findByRole('textbox', { name: /bunker uri/i });
    const nsec = nip19.nsecEncode(generateSecretKey());
    await user.type(field, nsec);
    await user.click(screen.getByRole('button', { name: /log in with bunker/i }));

    expect(await screen.findByText('Enter a bunker://… URI.')).toBeTruthy();
    expect(mockBunker).not.toHaveBeenCalled();
  });

  it('logs in with a browser extension', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    mockExtension.mockResolvedValue(undefined);
    renderDialog(onClose);

    await user.click(
      await screen.findByRole('button', { name: /log in with browser extension/i }),
    );

    await waitFor(() => expect(mockExtension).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('logs in with a bunker URI', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    mockBunker.mockResolvedValue(undefined);
    renderDialog(onClose);

    const field = await screen.findByRole('textbox', { name: /bunker uri/i });
    await user.type(field, 'bunker://abc@relay.example');
    await user.click(screen.getByRole('button', { name: /log in with bunker/i }));

    await waitFor(() =>
      expect(mockBunker).toHaveBeenCalledWith('bunker://abc@relay.example'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
