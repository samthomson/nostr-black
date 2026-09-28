import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileAvatar } from '@/components/ProfileAvatar';

vi.mock('@/hooks/useAsset', () => ({
  useAsset: (url: string | undefined) => ({
    url: url ? `blob:${url}` : undefined,
    error: undefined,
    ref: { current: null },
  }),
}));

const PUBKEY = 'a'.repeat(64);

describe('ProfileAvatar', () => {
  it('never renders npub-slice letter placeholders', () => {
    const { container } = render(
      <ProfileAvatar pubkey={PUBKEY} metadata={undefined} waitingMetadata />,
    );
    expect(container.textContent).toBe('');
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('spins while picture bytes are expected', () => {
    const { container } = render(
      <ProfileAvatar
        pubkey={PUBKEY}
        metadata={{ picture: 'https://example.com/a.png' }}
      />,
    );
    // AvatarImage mounts; fallback shows spinner until onLoadingStatusChange('loaded')
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(container.textContent).toBe('');
  });

  it('shows empty muted fallback when there is no picture', () => {
    const { container } = render(
      <ProfileAvatar pubkey={PUBKEY} metadata={{ name: 'alice' }} />,
    );
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
