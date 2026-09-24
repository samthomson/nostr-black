import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TorGate } from './TorGate';
import { isTor } from '@/net/net';

vi.mock('@/net/net', () => ({ isTor: vi.fn() }));
const mockIsTor = vi.mocked(isTor);

beforeEach(() => {
  mockIsTor.mockReset();
  window.sessionStorage.clear();
});

describe('TorGate', () => {
  it('blocks the app when tor is not confirmed — identically in dev and production', async () => {
    mockIsTor.mockResolvedValue(false);

    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );

    expect(await screen.findByText(/can't confirm you're on tor/i)).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect(mockIsTor).toHaveBeenCalledTimes(1);
  });

  it('renders the app when on tor', async () => {
    mockIsTor.mockResolvedValue(true);

    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );

    expect(await screen.findByText('the app')).toBeTruthy();
  });

  it('never locks the user out: continue-without-tor overrides the gate', async () => {
    mockIsTor.mockResolvedValue(false);

    const user = userEvent.setup();
    const { unmount } = render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );

    await user.click(await screen.findByRole('button', { name: /continue without tor/i }));
    expect(screen.getByText('the app')).toBeTruthy();
    expect(window.sessionStorage.getItem('nostr:tor-override')).toBe('1');

    // The override lasts for the tab session: a remount skips the check.
    unmount();
    mockIsTor.mockClear();
    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(mockIsTor).not.toHaveBeenCalled();
  });
});
