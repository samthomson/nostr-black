import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { BroadcastQueueDialog } from './BroadcastQueueDialog';
import { TestApp } from '@/test/TestApp';
import { enqueue, resetQueue, sentEntries } from '@/data/publish/queue';

const publish = vi.fn<(event: NostrEvent, relays: string[]) => Promise<void>>();
vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  publish: (...args: unknown[]) => publish(...(args as [NostrEvent, string[]])),
}));

// Dynamic import: the vi.mock registry above must be in place before the
// SUT (which imports publish at module scope) is evaluated.
const { useQueueDialog } = await import('@/hooks/useQueueDialog');

const note = (content: string): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: 1, tags: [], content }, generateSecretKey());

/** The dialog as the status bar mounts it. */
const QueueEntry = () => {
  const { element } = useQueueDialog();
  return <>{element}</>;
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await Promise.resolve();
  }
};

beforeEach(() => {
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  resetQueue();
  localStorage.removeItem('broadcast.queue');
  localStorage.removeItem('broadcast.sent');
});

describe('BroadcastQueueDialog', () => {
  it('shows each queued note with the relays it will go to', async () => {
    publish.mockRejectedValue(new Error('offline'));
    enqueue('note', note('stuck'), ['wss://relay.one/', 'wss://relay.two/']);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    render(
      <TestApp>
        <BroadcastQueueDialog open onOpenChange={vi.fn()} />
      </TestApp>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('note');
    expect(dialog.textContent).toContain('offline');
    // relays render as host pills, one per relay
    expect(screen.getByText('relay.one')).toBeTruthy();
    expect(screen.getByText('relay.two')).toBeTruthy();
  });

  it('lists the last five sent notes with their relays after the queue drains', async () => {
    enqueue('gone out', note('body'), ['wss://sentrelay/']);
    await settle();
    expect(sentEntries()).toHaveLength(1);

    render(
      <TestApp>
        <BroadcastQueueDialog open onOpenChange={vi.fn()} />
      </TestApp>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('sent');
    expect(dialog.textContent).toContain('gone out');
    expect(dialog.textContent).toContain('sentrelay');
    expect(dialog.textContent).not.toContain('nothing queued');
  });

  it('expands a queued note to its text and raw event', async () => {
    const user = userEvent.setup();
    publish.mockRejectedValue(new Error('offline'));
    enqueue('note', note('the visible text'), ['wss://relay.one/']);
    await settle();

    render(
      <TestApp>
        <BroadcastQueueDialog open onOpenChange={vi.fn()} />
      </TestApp>,
    );

    expect(screen.queryByText('the visible text')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'show note' }));
    expect(screen.getByText('the visible text')).toBeTruthy();
    // the raw signed event is inspectable too
    expect(screen.getByRole('button', { name: /hide note/ })).toBeTruthy();
  });

  it('the status-bar entry stays clickable when only the sent log remains', async () => {
    const user = userEvent.setup();
    enqueue('delivered', note('body'), ['wss://sentrelay/']);
    await settle();

    render(
      <TestApp>
        <QueueEntry />
      </TestApp>,
    );
    // queue drained, but the entry point persists for the sent log
    await user.click(screen.getByRole('button'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('delivered');
  });
});
