import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { TestApp } from '@/test/TestApp';
import { Composer } from '@/components/Composer';
import { scheduler } from '@/data/scheduler';
import { store } from '@/data/store';

const queryRelay = vi.fn<(url: string, filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@/net/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/net/net')>()),
  queryRelay: (...args: unknown[]) => queryRelay(...(args as [string, NostrFilter[]])),
}));

const settle = async () => {
  await scheduler.flush();
};

const metadata = (sk: Uint8Array, content: object): NostrEvent =>
  finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(content),
  }, sk);

const skShan = generateSecretKey();
const skBob = generateSecretKey();
const SHAN = getPublicKey(skShan);
const BOB = getPublicKey(skBob);

/** Composer is controlled — the tests drive it through real state. */
const Harness = () => {
  const [value, setValue] = useState('');
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      variant="post"
      grade="public"
    />
  );
};

const renderMentionComposer = () =>
  render(
    <TestApp
      userState={{ follows: { pubkeys: [SHAN, BOB], updatedAt: 1 } }}
    >
      <Harness />
    </TestApp>,
  );

beforeEach(() => {
  queryRelay.mockReset();
  queryRelay.mockResolvedValue([]);
});

describe('Composer `@` mention typeahead', () => {
  it('opens on @query, filters follows by display name, and inserts the NIP-27 entity on pick', async () => {
    store.ingest([
      metadata(skShan, { display_name: 'Shan O’Donnell', name: 'shan' }),
      metadata(skBob, { name: 'bob' }),
    ], '');
    const user = userEvent.setup();
    renderMentionComposer();
    await settle();

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, 'hey @sha');

    // the dropdown lists the matching follow — shan, not bob
    const shan = await screen.findByRole('option', { name: /Shan O’Donnell/ });
    const pick = within(shan).getByRole('button');
    expect(screen.queryByRole('option', { name: /bob/ })).toBeNull();

    // picking replaces the whole @run with the entity
    await user.click(pick);
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Shan/ })).toBeNull(),
    );
    expect((ta as HTMLTextAreaElement).value).toMatch(/^hey nostr:npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+ $/);
  });

  it('keyboard flow: arrow keys walk the rows, enter picks the lit one', async () => {
    store.ingest([
      metadata(skShan, { display_name: 'shan' }),
      metadata(skBob, { display_name: 'bob' }),
    ], '');
    const user = userEvent.setup();
    renderMentionComposer();
    await settle();

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    // 'b' preselects bob (prefix beats nothing else); 'a' after @ would
    // be ambiguous, so start from a two-person query
    await user.type(ta, '@');
    const listbox = await screen.findByRole('listbox', { name: 'people you follow' });
    expect(listbox).toBeTruthy();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    // back on row one: enter picks the first follow
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'people you follow' })).toBeNull(),
    );
    expect((ta as HTMLTextAreaElement).value).toMatch(/^nostr:npub1/);
  });

  it('escape dismisses the dropdown and leaves the typed @run untouched', async () => {
    store.ingest([metadata(skShan, { display_name: 'shan' })], '');
    const user = userEvent.setup();
    renderMentionComposer();
    await settle();

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, 'hi @sha');
    await screen.findByRole('listbox', { name: 'people you follow' });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'people you follow' })).toBeNull();
    expect(ta).toHaveValue('hi @sha');
  });

  it('after Escape, deleting and retyping the same @run reopens the dropdown', async () => {
    store.ingest([
      metadata(skShan, { display_name: 'shana' }),
      metadata(skBob, { display_name: 'shane' }),
    ], '');
    const user = userEvent.setup();
    renderMentionComposer();
    await settle();

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, '@sha');
    const listbox = await screen.findByRole('listbox', { name: 'people you follow' });
    // walk down before dismissing: the highlight must not survive
    await user.keyboard('{ArrowDown}');
    const moved = within(listbox).getAllByRole('option')[1];
    expect(moved).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'people you follow' })).toBeNull();

    // delete the run back to nothing, then retype the same `@` at the
    // same index: the user re-asked, so the dropdown must come back —
    // highlighted from the TOP, not wherever the old session sat
    await user.type(ta, '{backspace>5}');
    expect(ta).toHaveValue('');
    await user.type(ta, '@sha');
    const reopened = await screen.findByRole('listbox', { name: 'people you follow' });
    expect(within(reopened).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('no follow matches → no dropdown; a word-internal @ never opens one', async () => {
    store.ingest([metadata(skShan, { display_name: 'shan' })], '');
    const user = userEvent.setup();
    renderMentionComposer();
    await settle();

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, 'email me a@b then @zzzz');
    expect(screen.queryByRole('listbox', { name: 'people you follow' })).toBeNull();
  });

  it('enter with the dropdown open picks the mention instead of submitting', async () => {
    store.ingest([metadata(skShan, { display_name: 'shan' })], '');
    const submitted = vi.fn();
    const user = userEvent.setup();
    render(
      <TestApp userState={{ follows: { pubkeys: [SHAN], updatedAt: 1 } }}>
        <Controlled variant="reply" onSubmit={submitted} />
      </TestApp>,
    );
    await settle();

    const ta = screen.getByLabelText('reply…');
    await user.click(ta);
    await user.type(ta, '@sha');
    await screen.findByRole('listbox', { name: 'people you follow' });
    await user.keyboard('{Enter}');

    // the pick consumed the enter — the draft holds the entity, nothing sent
    expect(screen.queryByRole('listbox', { name: 'people you follow' })).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
    expect((ta as HTMLTextAreaElement).value).toMatch(/^nostr:npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+ $/);

    // now the caret sits after the entity: plain enter in a reply submits
    await user.keyboard('{Enter}');
    expect(submitted).toHaveBeenCalledTimes(1);
  });
});

/** Same harness, but the variant and submit handler are injectable. */
const Controlled = ({
  variant,
  onSubmit,
}: {
  variant: 'post' | 'reply';
  onSubmit: () => void;
}) => {
  const [value, setValue] = useState('');
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      variant={variant}
      grade="public"
    />
  );
};
