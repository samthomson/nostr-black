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
  window.localStorage.clear();
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

  it('never locks the user out, and the override never persists across loads', async () => {
    mockIsTor.mockResolvedValue(false);

    const user = userEvent.setup();
    const { unmount } = render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );

    await user.click(await screen.findByRole('button', { name: /continue without tor/i }));
    expect(screen.getByText('the app')).toBeTruthy();

    // The override was written nowhere: every storage a reload would keep
    // is still empty after clicking through.
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');

    // And the next mount (same document — storages survive it, as they
    // would a reload) probes again instead of remembering.
    unmount();
    mockIsTor.mockClear();
    mockIsTor.mockResolvedValue(false);
    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );
    expect(await screen.findByText(/can't confirm you're on tor/i)).toBeTruthy();
    expect(mockIsTor).toHaveBeenCalledTimes(1);
  });
});
