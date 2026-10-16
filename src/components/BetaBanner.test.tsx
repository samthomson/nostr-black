import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BetaBanner } from './BetaBanner';

const STORAGE_KEY = 'nostr:beta-banner-dismissed';

beforeEach(() => {
  window.localStorage.clear();
});

describe('BetaBanner', () => {
  it('shows the beta notice by default', () => {
    render(<BetaBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/beta af/i);
  });

  it('dismiss hides the bar and persists across remount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BetaBanner />);

    await user.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

    unmount();
    render(<BetaBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
