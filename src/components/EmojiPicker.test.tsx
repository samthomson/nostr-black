import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '@/components/Composer';
import { EmojiPicker } from '@/components/EmojiPicker';

/** Composer is controlled — the tests drive it through real state, the
 *  way NoteComposer holds its draft. */
const Harness = ({
  initial = '',
  onSubmit = () => {},
  variant = 'post' as const,
  grade = 'public' as const,
  showAttach = false,
}: {
  initial?: string;
  onSubmit?: () => void;
  variant?: 'post' | 'edit';
  grade?: 'public' | 'private';
  showAttach?: boolean;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      variant={variant}
      grade={grade}
      {...(showAttach ? { onAddFiles: () => {} } : {})}
    />
  );
};

describe('EmojiPicker', () => {
  it('searches the bundled data and selects a matching emoji', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // the data loads async in frimousse; search narrows the full set
    const search = await screen.findByPlaceholderText('search…');
    await user.type(search, 'thumbs up');

    // frimousse renders a grid; emoji cells are gridcell buttons
    const match = await screen.findByRole('gridcell', { name: /thumbs up/i });
    await user.click(match);

    expect(onSelect).toHaveBeenCalledWith('👍');
  });

  it('shows the no-match message for a nonsense search', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={vi.fn()} />);

    await screen.findByPlaceholderText('search…');
    await user.type(screen.getByPlaceholderText('search…'), 'zzzzqqqq');

    expect(await screen.findByText('no emoji found')).toBeTruthy();
  });

  it('works with no network: the data resolves synchronously from the bundle', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={onSelect} />);

    // no vi.mock of fetch, no waiting on a resolver — search works at once
    await user.type(await screen.findByPlaceholderText('search…'), 'wave');

    expect(await screen.findByRole('gridcell', { name: /waving hand/i })).toBeTruthy();
  });
});

describe('Composer emoji button', () => {
  it('inserts a picked emoji at the cursor and reports the new value', async () => {
    const user = userEvent.setup();
    render(<Harness initial="hello world" variant="edit" />);

    // edit composers have no attach button but still get the emoji picker
    await user.click(screen.getByRole('button', { name: 'add emoji' }));
    const search = await screen.findByPlaceholderText('search…');
    await user.type(search, 'fire');
    await user.click(await screen.findByRole('gridcell', { name: /fire/i }));

    // cursor was at 0, so the emoji lands before "hello world". search
    // "fire" ranks ❤️‍🔥 (heart on fire) above 🔥 (fire).
    expect(screen.getByLabelText('edit note')).toHaveValue('❤️‍🔥hello world');
  });

  it('picker closes after a pick, so the next pick needs a fresh open', async () => {
    const user = userEvent.setup();
    render(<Harness variant="edit" />);

    await user.click(screen.getByRole('button', { name: 'add emoji' }));
    const search = await screen.findByPlaceholderText('search…');
    await user.type(search, 'fire');
    await user.click(await screen.findByRole('gridcell', { name: /fire/i }));

    await vi.waitFor(() => {
      expect(screen.queryByPlaceholderText('search…')).toBeNull();
    });
  });

  it('keeps offering the picker on edit composers, which have no attach button', () => {
    render(<Harness variant="edit" />);
    expect(screen.getByRole('button', { name: 'add emoji' })).toBeTruthy();
  });

  it('the attach and emoji buttons sit left, the CTA right', () => {
    render(<Harness initial="x" showAttach />);
    const emojiBtn = screen.getByRole('button', { name: 'add emoji' });
    // both tools share the left group; the CTA lives in the right group
    const tools = emojiBtn.parentElement!;
    expect(tools.querySelector('label[aria-label="attach images"]')).toBeTruthy();
    const footer = tools.parentElement!;
    const cta = [...footer.children].at(-1)!;
    expect(cta.textContent).toContain('broadcast');
    expect(footer.className).toContain('justify-between');
  });
});

describe('Composer `:` typeahead', () => {
  it('opens the picker dropdown on :query and replaces the run on pick', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, 'nice work :thumbs');

    // the dropdown is the same frimousse picker, compact — its search
    // mirrors the typed query and the grid lists the matches
    const dropdownSearch = await screen.findByPlaceholderText('search…');
    expect(dropdownSearch).toHaveValue('thumbs');
    const cell = await screen.findByRole('gridcell', { name: /thumbs up/i });
    await user.click(cell);

    // picking replaces the whole `:thumbs` run, keeps the prose, one space
    expect(screen.getByLabelText("what's happening?")).toHaveValue('nice work 👍 ');
    expect(screen.queryByPlaceholderText('search…')).toBeNull();
  });

  it('escape dismisses the dropdown and leaves the text untouched', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, ':fire');
    await screen.findByPlaceholderText('search…');
    // keyboard flow: ArrowDown hands focus to the dropdown, Escape there
    // dismisses it and returns the caret to the textarea
    await user.keyboard('{ArrowDown}');
    expect(screen.getByPlaceholderText('search…')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('search…')).toBeNull();

    // text untouched after dismiss — including the literal `:fire`
    expect(ta).toHaveValue(':fire');
    expect(ta).toHaveFocus();
  });

  it('arrow down into the dropdown, enter picks the active emoji', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, ':thumbs');
    await screen.findByPlaceholderText('search…');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByPlaceholderText('search…')).toHaveFocus();
    // frimousse: focus inside the root, ArrowDown activates the first
    // cell, Enter selects it. Ranked first for "thumbs" is 👎
    // (thumbs_down) — the point is the keyboard picked it.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText("what's happening?")).toHaveValue('👎 ');
    expect(screen.queryByPlaceholderText('search…')).toBeNull();
  });

  it('typing `: ` (colon space) does not open the dropdown', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, 'hi : ');
    expect(screen.queryByPlaceholderText('search…')).toBeNull();
  });

  it('a query with no matches keeps the dropdown closed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const ta = screen.getByLabelText("what's happening?");
    await user.click(ta);
    await user.type(ta, ':zzzzqqqq');
    expect(screen.queryByPlaceholderText('search…')).toBeNull();
  });
});
