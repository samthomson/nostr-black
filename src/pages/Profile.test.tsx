import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { ProfilePage } from '@/pages/Profile';
import { store } from '@/data/store';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const metadata = (sk: Uint8Array, content: object): NostrEvent =>
  finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(content),
  }, sk);

const PICTURE = 'https://example.com/face.png';
const BANNER = 'https://example.com/cover.png';

const renderProfile = (event: NostrEvent) => {
  store.ingest([event], '');
  render(
    <TestApp>
      <ProfilePage pubkey={event.pubkey} />
    </TestApp>,
  );
};
const showingSrc = () =>
  screen.getByRole('dialog').querySelector('img:not([aria-hidden])')?.getAttribute('src');

const activeDot = () =>
  screen.getByRole('dialog').querySelector('button[aria-label^="image "][aria-current="true"]')?.getAttribute('aria-label');

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
});

describe('Profile lightbox', () => {
  it('opens the avatar and banner in one shared set', async () => {
    const user = userEvent.setup();
    const sk = generateSecretKey();
    renderProfile(metadata(sk, { name: 'pat', picture: PICTURE, banner: BANNER }));
    // the display picture is image one of the set
    await user.click(await screen.findByRole('button', { name: 'open profile picture' }));
    expect(showingSrc()).toBe(PICTURE);
    expect(activeDot()).toBe('image 1');

    await user.click(screen.getByRole('button', { name: 'next image' }));
    expect(showingSrc()).toBe(BANNER);
    expect(activeDot()).toBe('image 2');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    // the cover opens on the second image of the same set
    await user.click(screen.getByRole('button', { name: 'open banner image' }));
    expect(showingSrc()).toBe(BANNER);
    expect(activeDot()).toBe('image 2');
  });

  it('a picture without a banner opens a single-image lightbox with no nav', async () => {
    const user = userEvent.setup();
    const sk = generateSecretKey();
    renderProfile(metadata(sk, { name: 'solo', picture: PICTURE }));

    await user.click(await screen.findByRole('button', { name: 'open profile picture' }));
    expect(showingSrc()).toBe(PICTURE);
    expect(screen.queryByTestId('lightbox-nav')).toBeNull();
    expect(screen.queryByRole('button', { name: 'open banner image' })).toBeNull();
  });

  it('no picture means no zoom affordance at all', async () => {
    const sk = generateSecretKey();
    renderProfile(metadata(sk, { name: 'ghost' }));

    await screen.findByText('ghost');
    expect(screen.queryByRole('button', { name: 'open profile picture' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'open banner image' })).toBeNull();
  });
});
