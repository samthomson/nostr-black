import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { nip19 } from 'nostr-tools';

import { EventInfoDialog } from './EventInfoDialog';
import { Note } from './Note';
import { TestApp } from '@/test/TestApp';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const EVENT_ID = 'e'.repeat(64);

const event = {
  id: EVENT_ID,
  pubkey: A,
  created_at: 1700000600,
  kind: 1,
  tags: [
    ['p', B],
    ['e', 'f'.repeat(64)],
    ['t', 'nostr'],
  ],
  content: 'hello',
  sig: 'd'.repeat(128),
};

const renderDialog = () =>
  render(
    <TestApp>
      <EventInfoDialog event={event} open onOpenChange={vi.fn()} />
    </TestApp>,
  );

describe('EventInfoDialog', () => {
  it('links the author profile and the event id', async () => {
    renderDialog();

    const authorLink = await screen.findByRole('link', { name: new RegExp(nip19.npubEncode(A)) });
    expect(authorLink.getAttribute('href')).toBe(`/${nip19.npubEncode(A)}`);

    const idLink = screen.getByRole('link', { name: EVENT_ID });
    expect(idLink.getAttribute('href')).toContain('nevent1');
  });

  it('parses p and e tags into profile/event links', async () => {
    renderDialog();

    const tagLinks = await screen.findAllByRole('link');
    expect(
      tagLinks.some((a) => a.getAttribute('href') === `/${nip19.npubEncode(B)}`),
    ).toBe(true);
    expect(tagLinks.some((a) => (a.getAttribute('href') ?? '').includes('nevent1'))).toBe(true);
    expect(screen.getByText('[t]')).toBeTruthy();
  });

  it('shows the raw event json', async () => {
    renderDialog();

    expect(await screen.findByText(/"kind": 1/)).toBeTruthy();
    expect(screen.getByText(/"content": "hello"/)).toBeTruthy();
  });

  it('never crashes on malformed ids — falls back to plain text', async () => {
    render(
      <TestApp>
        <EventInfoDialog
          event={{ ...event, id: 'not-hex!', tags: [['e', 'also-not-hex']] }}
          open
          onOpenChange={vi.fn()}
        />
      </TestApp>,
    );

    expect(await screen.findByText('not-hex!')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'not-hex!' })).toBeNull();
  });
});

describe('Note UI', () => {
  it('links the author name to their profile route', async () => {
    render(
      <TestApp>
        <Note event={event} />
      </TestApp>,
    );

    // npub fallback name until metadata resolves — still a profile link.
    const link = await screen.findByRole('link', { name: /^npub1/ });
    expect(link.getAttribute('href')).toBe(`/${nip19.npubEncode(A)}`);
  });

  it('shows which relays the note was found on', async () => {
    render(
      <TestApp>
        <Note event={event} foundOn={['wss://one.example/', 'wss://two.example/']} />
      </TestApp>,
    );

    expect(await screen.findByText(/via one\.example, two\.example/)).toBeTruthy();
  });

  it('renders a kind 6 repost with the embedded note', async () => {
    const inner = { ...event, id: 'f'.repeat(64), content: 'the reposted words' };
    const repost = { ...event, kind: 6, content: JSON.stringify(inner) };

    render(
      <TestApp>
        <Note event={repost} />
      </TestApp>,
    );

    expect(await screen.findByText('the reposted words')).toBeTruthy();
    expect(screen.getAllByText(/repost/).length).toBeGreaterThan(0);
  });
});
