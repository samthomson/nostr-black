import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactionSection } from './ReactionSection';
import { TestApp } from '@/test/TestApp';

// frimousse's virtualized rows re-render on focus changes, so user-event's
// pointer walk can land on a detached node in jsdom (the browser picks
// fine). The picker's contract is onSelect(emoji) — stub it.
vi.mock('@/components/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (e: string) => void }) => (
    <div data-testid="mock-picker">
      <button type="button" data-testid="pick-thumbs" onClick={() => onSelect('👍')} />
      <button type="button" data-testid="pick-star" onClick={() => onSelect('⭐')} />
    </div>
  ),
}));
const section = () => screen.getByText('reactions').closest('section')!;
const chips = () =>
  [...section().querySelectorAll<HTMLElement>('[data-slot="chip-input"] span')]
    .filter((s) => s.querySelector('button'));
const chipOrNull = (emoji: string) =>
  [...chips()].find((c) => c.textContent?.trim() === emoji);
const chip = (emoji: string) => {
  const el = chipOrNull(emoji);
  if (!el) throw new Error(`no chip for ${emoji}`);
  return el;
};
const removeChip = (emoji: string) => chip(emoji).querySelector('button')!;
/** The chip carrying the selected ring — the current default reaction. */
const defaultChip = () =>
  [...chips()].find((c) => c.className.includes('ring-1'))?.textContent?.trim();
const field = () => section().querySelector<HTMLInputElement>('input')!;
const typeEmoji = async (emoji: string) => {
  const user = userEvent.setup();
  await user.type(field(), emoji);
  await user.keyboard('{Enter}');
};

beforeEach(() => {
  window.localStorage.removeItem('test-app-config');
});

describe('ReactionSection', () => {
  it('starts with six preset chips', () => {
    render(<TestApp><ReactionSection /></TestApp>);
    expect(chips()).toHaveLength(6);
    expect(chip('❤')).toBeTruthy();
  });

  it('at the cap there is no field to type into', () => {
    render(<TestApp><ReactionSection /></TestApp>);
    expect(field()).toBeNull();
    expect(chips()).toHaveLength(6);
  });

  it('removing a chip brings the field back', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(removeChip('😂'));
    expect(field()).toBeTruthy();
    await typeEmoji('🚀');
    expect(chip('🚀')).toBeTruthy();
    expect(chips()).toHaveLength(6);
  });

  it('a duplicate chip is rejected', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(removeChip('😂'));
    await typeEmoji('❤');
    expect(chips()).toHaveLength(5); // duplicate, nothing added
  });

  it('a chip removes itself via its ×; a non-default removal keeps the default', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(removeChip('😂'));
    expect(chipOrNull('😂')).toBeUndefined();
    expect(chips()).toHaveLength(5);
    // default was '+', untouched — still ringed
    expect(defaultChip()).toBe('+');
  });

  it('removing the default chip leaves the app default untouched (defaults stay in config)', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(removeChip('+'));
    expect(chipOrNull('+')).toBeUndefined();
    expect(chips()).toHaveLength(5);
  });

  it('clicking a chip makes it the default reaction', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(chip('🔥'));
    expect(defaultChip()).toBe('🔥');
  });

  it('clicking a chip makes it the default reaction', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    await user.click(chip('🔥'));
    expect(JSON.parse(window.localStorage.getItem('test-app-config')!).defaultReaction).toBe('🔥');
  });

  it('the picker button appends a picked emoji when under the cap', async () => {
    const user = userEvent.setup();
    render(<TestApp><ReactionSection /></TestApp>);
    // remove two to make room, then pick via the picker button
    await user.click(removeChip('👏'));
    await user.click(removeChip('🙏'));
    await user.click(screen.getByRole('button', { name: 'add emoji' }));
    await user.click(screen.getByTestId('pick-thumbs'));
    expect(chip('👍')).toBeTruthy();
    expect(chips()).toHaveLength(5);
  });
});
