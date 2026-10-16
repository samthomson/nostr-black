import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox } from '@/components/Lightbox';

const urls = [
  'https://example.com/a.png',
  'https://example.com/b.png',
  'https://example.com/c.png',
];

const renderAt = (index: number, onIndex: (i: number) => void = vi.fn(), grade: 'public' | 'private' = 'public') =>
  render(
    <Lightbox urls={urls} index={index} onIndex={onIndex} onClose={vi.fn()} alt="note media" grade={grade} />,
  );

/** The visible (non-hidden, non-preload) img — the one being shown. */
const showingImg = () => {
  const visible = screen.getByRole('dialog').querySelector('img:not([aria-hidden])');
  if (!visible) throw new Error('no visible image');
  return visible;
};

const hiddenImgSrcs = () =>
  Array.from(screen.getByRole('dialog').querySelectorAll('img[aria-hidden="true"]'))
    .map((img) => img.getAttribute('src'));

describe('Lightbox', () => {
  it('shows the current image with one dot per image and no counter', () => {
    renderAt(1);
    expect(showingImg()).toHaveAttribute('src', urls[1]);
    expect(screen.getAllByRole('button', { name: /^image \d$/ })).toHaveLength(3);
    expect(screen.queryByTestId('lightbox-counter')).toBeNull();
  });

  it('keeps focus on the overlay — no control is focused on open', () => {
    renderAt(1);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'next image' }));
  });

  it('steps through images with next and never calls past the ends', async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    renderAt(0, onIndex);

    // prev is disabled at the first image — clicking it does nothing
    await user.click(screen.getByRole('button', { name: 'previous image' }));
    expect(onIndex).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'next image' }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
  });

  it('disables prev at the first image and next at the last', () => {
    const { rerender } = renderAt(0);
    expect(screen.getByRole('button', { name: 'previous image' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'next image' })).toBeEnabled();

    rerender(
      <Lightbox urls={urls} index={2} onIndex={vi.fn()} onClose={vi.fn()} alt="note media" grade="public" />,
    );
    expect(screen.getByRole('button', { name: 'previous image' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'next image' })).toBeDisabled();
  });

  it('jumps straight to a dot target', async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    renderAt(0, onIndex);
    await user.click(screen.getByRole('button', { name: 'image 3' }));
    expect(onIndex).toHaveBeenCalledWith(2);
  });

  it('preloads the neighbours through hidden images', () => {
    renderAt(1);
    expect(hiddenImgSrcs()).toContain(urls[0]);
    expect(hiddenImgSrcs()).toContain(urls[2]);
  });

  it('wears the privacy grade of its content', () => {
    const { rerender } = renderAt(0, vi.fn(), 'private');
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.backgroundColor).toBe('var(--privacy-private)');
    expect(dialog.style.color).toBe('var(--privacy-public)');

    rerender(<Lightbox urls={urls} index={0} onIndex={vi.fn()} onClose={vi.fn()} alt="note media" grade="public" />);
    expect(screen.getByRole('dialog').style.backgroundColor).toBe('var(--privacy-public)');
  });

  it('hides navigation and preloads for a single image', () => {
    render(<Lightbox urls={[urls[0]]} index={0} onIndex={vi.fn()} onClose={vi.fn()} alt="note media" grade="public" />);
    expect(screen.queryByTestId('lightbox-nav')).toBeNull();
    expect(screen.queryByRole('button', { name: 'next image' })).toBeNull();
  });
});
