import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TorGate } from './TorGate';
import { isTor } from '@/net/net';
import { resetUseIsTor } from '@/hooks/useEgress';

vi.mock('@/net/net', () => ({ isTor: vi.fn() }));
const mockIsTor = vi.mocked(isTor);

beforeEach(() => {
  mockIsTor.mockReset();
  resetUseIsTor();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  resetUseIsTor();
  window.sessionStorage.clear();
});

afterEach(() => {
  resetUseIsTor();
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

  it('keeps the app on remount after continue without tor — feed/profile must not re-gate', async () => {
    mockIsTor.mockResolvedValue(false);

    const user = userEvent.setup();
    const { unmount } = render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );

    await user.click(await screen.findByRole('button', { name: /continue without tor/i }));
    expect(screen.getByText('the app')).toBeTruthy();

    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');

    unmount();
    mockIsTor.mockClear();
    mockIsTor.mockResolvedValue(false);
    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByText(/can't confirm you're on tor/i)).toBeNull();
  });

  it('does not flash connecting after tor is already known', async () => {
    mockIsTor.mockResolvedValue(true);

    const { unmount } = render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );
    expect(await screen.findByText('the app')).toBeTruthy();
    unmount();

    render(
      <TorGate>
        <p>the app</p>
      </TorGate>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByText('connecting…')).toBeNull();
  });
});
