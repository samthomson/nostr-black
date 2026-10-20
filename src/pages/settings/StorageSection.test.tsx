import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useLayoutEffect, type ReactNode } from 'react';
import { TestApp } from '@/test/TestApp';
import { StorageSection } from './StorageSection';
import { useKeystore } from '@/auth/useKeystore';
import { resetQueue } from '@/data/publish/queue';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();
const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

// Hoisted server-list state the mocked hook reads.
const servers = vi.hoisted(() => ({
  declared: [] as string[],
  fromRelayList: [] as string[],
}));
vi.mock('@/data/hooks/useBlossomServers', () => ({
  useBlossomServers: () => ({
    servers: [...servers.declared, ...servers.fromRelayList],
    declared: servers.declared,
    fromRelayList: servers.fromRelayList,
    event: undefined,
    pending: false,
  }),
}));

const Unlock = ({ nsec, children }: { nsec: string; children: ReactNode }) => {
  const ks = useKeystore();
  useLayoutEffect(() => {
    if (!ks.unlocked) ks.login(nsec);
  }, [ks, nsec]);
  if (!ks.unlocked) return null;
  return children;
};

beforeAll(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  resetQueue();
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  servers.declared = [];
  servers.fromRelayList = [];
});

const confirmBroadcast = async (user: { click: (el: Element) => Promise<void> }) => {
  const dialog = await screen.findByRole('dialog');
  for (const b of await within(dialog).findAllByRole('button')) {
    if ((b.textContent ?? '').trim() === 'broadcast') {
      await user.click(b);
      return;
    }
  }
  throw new Error('broadcast button not found');
};

describe('StorageSection', () => {
  it('shows declared servers with a primary badge and read-only relay-derived servers', async () => {
    servers.declared = ['https://blossom.mine.example'];
    servers.fromRelayList = ['https://blossom.primal.net'];
    const sk = generateSecretKey();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <StorageSection />
        </Unlock>
      </TestApp>,
    );

    expect(await screen.findByText('https://blossom.mine.example')).toBeTruthy();
    expect(screen.getByText('https://blossom.primal.net')).toBeTruthy();
    // Only your own list is editable: the declared row carries the badge
    // and remove control; the relay-derived row is read-only.
    const rows = document.querySelectorAll('li');
    expect(within(rows[0] as HTMLElement).getByText('primary')).toBeTruthy();
    expect(screen.getByText('from relays')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: 'remove' })).toBeTruthy();
    expect(within(rows[2] as HTMLElement).queryByRole('button', { name: 'remove' })).toBeNull();
  });

  it('moves a server up and down to reorder fallback precedence', async () => {
    servers.declared = ['https://a.example', 'https://b.example'];
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <StorageSection />
        </Unlock>
      </TestApp>,
    );

    await screen.findByText('https://a.example');
    // On open the first row is primary and can't move up; the second can.
    expect(screen.getByRole('button', { name: 'move https://a.example up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'move https://b.example up' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'move https://b.example up' }));
    // b is now primary; the list reorders and a moves down.
    const rows = document.querySelectorAll('li');
    expect(rows[0]).toHaveTextContent('https://b.example');
    expect(rows[1]).toHaveTextContent('https://a.example');
    expect(screen.getByRole('button', { name: 'publish list' })).toBeEnabled();
  });

  it('shows the app default server when no list exists yet', async () => {
    const sk = generateSecretKey();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <StorageSection />
        </Unlock>
      </TestApp>,
    );

    expect(await screen.findByText('using the app default until you add one')).toBeTruthy();
    expect(screen.getByText('default')).toBeTruthy();
  });

  it('adds a server and broadcasts a kind 10063 with the new list', async () => {
    servers.declared = ['https://blossom.mine.example'];
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <StorageSection />
        </Unlock>
      </TestApp>,
    );

    await screen.findByText('https://blossom.mine.example');
    await user.type(screen.getByRole('textbox', { name: 'add upload server' }), 'cdn.example.com');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByText('https://cdn.example.com')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'publish list' }));
    // The modal previews the diff: the addition in green.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('https://cdn.example.com')).toBeTruthy();
    await confirmBroadcast(user);

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const [event] = publish.mock.calls[0];
    expect(event.kind).toBe(10063);
    expect(event.pubkey).toBe(getPublicKey(sk));
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ['server', 'https://blossom.mine.example'],
        ['server', 'https://cdn.example.com'],
      ]),
    );
  });

  it('junk input never enters the list', async () => {
    const sk = generateSecretKey();
    const user = userEvent.setup();
    render(
      <TestApp>
        <Unlock nsec={nip19.nsecEncode(sk)}>
          <StorageSection />
        </Unlock>
      </TestApp>,
    );

    await screen.findByRole('textbox', { name: 'add upload server' });
    await user.type(screen.getByRole('textbox', { name: 'add upload server' }), 'not a url');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.queryByText('https://not a url')).toBeNull();
    expect(screen.getByRole('button', { name: 'publish list' })).toBeDisabled();
  });
});
